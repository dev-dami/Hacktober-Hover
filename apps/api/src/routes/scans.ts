import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { Deps } from "../deps.ts";
import { LabelFields } from "../fields.ts";
import { ImageError, prepareImage, stripMetadata } from "../images.ts";
import { check } from "../match.ts";

const ID = /^[0-9a-f-]{36}$/;

export function scanRoutes(deps: Deps) {
  const app = new Hono();
  const scansDir = resolve(deps.config.storageDir, "scans");
  const now = deps.now ?? (() => new Date());

  // Upload a label photo. Saves it with the model's reading as an unreviewed training example.
  app.post("/scans", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("image");
    if (!(file instanceof File)) return c.json({ error: "Attach a photo in the 'image' field." }, 400);

    let prepared;
    try {
      prepared = await prepareImage(file);
    } catch (error) {
      if (error instanceof ImageError) return c.json({ error: error.message }, 400);
      throw error;
    }

    const id = crypto.randomUUID();
    const dir = resolve(scansDir, id);
    await mkdir(dir, { recursive: true });
    const originalFile = `original.${prepared.originalExtension}`;
    await Promise.all([
      Bun.write(resolve(dir, originalFile), await stripMetadata(prepared.original)),
      Bun.write(resolve(dir, "image.jpg"), prepared.jpeg),
    ]);

    let extraction: Awaited<ReturnType<NonNullable<Deps["ai"]>["extractLabel"]>> | null = null;
    let aiError: string | null = null;
    if (deps.ai) {
      try {
        extraction = await deps.ai.extractLabel(prepared.jpeg, "image/jpeg");
        await Bun.write(resolve(dir, "model-reply.txt"), extraction.raw);
      } catch (error) {
        console.error("[scan] extraction failed", error);
        aiError = "The AI could not read this photo. Enter the details by hand.";
      }
    } else {
      aiError = "AI reading is not configured on this server (GEMINI_API_KEY). Enter the details by hand.";
    }

    deps.db.insertScan({
      id,
      createdAt: now().toISOString(),
      status: "unreviewed",
      model: extraction ? deps.ai!.model : null,
      extracted: extraction?.fields ?? null,
      corrected: null,
      notes: extraction?.notes ?? null,
      originalFile,
      imageFile: "image.jpg",
      width: prepared.width,
      height: prepared.height,
    });

    return c.json(
      {
        id,
        imageUrl: `/api/scans/${id}/image`,
        fields: extraction?.fields ?? null,
        notes: extraction?.notes ?? null,
        aiError,
      },
      201,
    );
  });

  app.get("/scans/:id/image", async (c) => {
    const id = c.req.param("id");
    const scan = ID.test(id) ? deps.db.getScan(id) : null;
    if (!scan) return c.json({ error: "Scan not found" }, 404);
    return new Response(Bun.file(resolve(scansDir, id, scan.imageFile)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
    });
  });

  // The person confirms or corrects the fields: this is the training label for the photo.
  app.patch("/scans/:id", zValidator("json", z.object({ fields: LabelFields })), (c) => {
    const id = c.req.param("id");
    if (!ID.test(id) || !deps.db.getScan(id)) return c.json({ error: "Scan not found" }, 404);
    deps.db.reviewScan(id, c.req.valid("json").fields);
    return c.json({ id, status: "reviewed" });
  });

  // Deterministic registry + alert matching.
  app.post("/check", zValidator("json", z.object({ fields: LabelFields })), (c) => {
    return c.json(check(c.req.valid("json").fields, deps.datasets));
  });

  // Plain-language explanation of the check, grounded in the matched alerts.
  app.post("/explain", zValidator("json", z.object({ fields: LabelFields })), async (c) => {
    if (!deps.ai) return c.json({ error: "AI explanations are not configured on this server." }, 503);
    const fields = c.req.valid("json").fields;
    const result = check(fields, deps.datasets);
    try {
      return c.json(await deps.ai.explain(fields, result, deps.datasets));
    } catch (error) {
      console.error("[explain] failed", error);
      return c.json({ error: "The AI explanation failed. The matched alerts are still listed above." }, 502);
    }
  });

  return app;
}
