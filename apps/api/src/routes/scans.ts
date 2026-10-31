import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { KEY_FIELDS, runCloseup, runVerification, type AgentEvent, type RunSummary } from "../agent.ts";
import type { Deps } from "../deps.ts";
import { EMPTY_FIELDS, LabelFields } from "../fields.ts";
import type { FieldName } from "../gemma.ts";
import { ImageError, prepareImage, stripMetadata } from "../images.ts";
import { check } from "../match.ts";

const ID = /^[0-9a-f-]{36}$/;
const FIELD_NAMES = Object.keys(EMPTY_FIELDS) as [FieldName, ...FieldName[]];

export function scanRoutes(deps: Deps) {
  const app = new Hono();
  const scansDir = resolve(deps.config.storageDir, "scans");
  const now = deps.now ?? (() => new Date());

  const findScan = (id: string) => (ID.test(id) ? deps.db.getScan(id) : null);

  async function readImage(c: Context) {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("image");
    if (!(file instanceof File)) throw new ImageError("Attach a photo in the 'image' field.");
    return { prepared: await prepareImage(file), form: form! };
  }

  /** Run the agent and stream its events as Server-Sent Events; store the run when it finishes. */
  function streamRun(c: Context, scanId: string, kind: "verify" | "closeup", run: (emit: (e: AgentEvent) => void, signal: AbortSignal) => Promise<RunSummary>) {
    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      let writes = Promise.resolve();
      const emit = (event: AgentEvent) => {
        writes = writes.then(() => stream.writeSSE({ event: event.type, data: JSON.stringify(event) })).catch(() => {});
      };
      const startedAt = now().toISOString();
      // Careful reads go ~30 s without an event; servers and proxies drop idle connections.
      // An SSE comment every 5 s keeps the stream open and is ignored by clients.
      const heartbeat = setInterval(() => {
        writes = writes.then(() => stream.write(": keep-alive\n\n")).then(() => {}).catch(() => {});
      }, 5_000);
      try {
        const summary = await run(emit, controller.signal);
        // A run the client walked away from says nothing about the photo; don't count it.
        if (controller.signal.aborted) return;
        deps.db.insertRun({ id: crypto.randomUUID(), scanId, kind, startedAt, ms: summary.ms, status: summary.status, summary });
        if (summary.status !== "failed") deps.db.setScanExtraction(scanId, summary.fields, deps.ai!.model, summary.notes);
      } catch (error) {
        console.error(`[agent] ${kind} failed`, error);
        emit({ type: "error", message: "The check stopped unexpectedly. Enter or correct the details by hand." });
      } finally {
        clearInterval(heartbeat);
      }
      await writes;
    });
  }

  // Upload a label photo. Returns at once; reading happens in /verify.
  app.post("/scans", async (c) => {
    let prepared;
    try {
      ({ prepared } = await readImage(c));
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
    deps.db.insertScan({
      id,
      createdAt: now().toISOString(),
      status: "unreviewed",
      model: null,
      extracted: null,
      corrected: null,
      notes: null,
      originalFile,
      imageFile: "image.jpg",
      width: prepared.width,
      height: prepared.height,
    });
    return c.json(
      {
        id,
        imageUrl: `/api/scans/${id}/image`,
        aiAvailable: !!deps.ai,
        aiError: deps.ai ? null : "AI reading is not configured on this server (GEMINI_API_KEY). Enter the details by hand.",
      },
      201,
    );
  });

  // Agent: read the label until the key fields are confirmed (SSE).
  app.post("/scans/:id/verify", async (c) => {
    const scan = findScan(c.req.param("id"));
    if (!scan) return c.json({ error: "Scan not found" }, 404);
    if (!deps.ai) return c.json({ error: "AI reading is not configured on this server." }, 503);
    const image = new Uint8Array(await Bun.file(resolve(scansDir, scan.id, scan.imageFile)).arrayBuffer());
    const ai = deps.ai;
    return streamRun(c, scan.id, "verify", (emit, signal) =>
      runVerification({ ai, datasets: deps.datasets, image, mimeType: "image/jpeg", emit, signal }),
    );
  });

  // Agent follow-up: read the requested fields from a close-up photo (SSE).
  app.post("/scans/:id/closeup", async (c) => {
    const scan = findScan(c.req.param("id"));
    if (!scan) return c.json({ error: "Scan not found" }, 404);
    if (!deps.ai) return c.json({ error: "AI reading is not configured on this server." }, 503);
    const previous = deps.db.latestRun(scan.id);
    if (!previous) return c.json({ error: "Run /verify on this scan first." }, 409);
    let read;
    try {
      read = await readImage(c);
    } catch (error) {
      if (error instanceof ImageError) return c.json({ error: error.message }, 400);
      throw error;
    }
    const requested = z.array(z.enum(FIELD_NAMES)).safeParse(JSON.parse(String(read.form.get("fields") ?? "null")));
    const fields = requested.success && requested.data.length ? requested.data : KEY_FIELDS;
    const dir = resolve(scansDir, scan.id);
    const n = (await readdir(dir)).filter((f) => f.startsWith("closeup-")).length + 1;
    await Bun.write(resolve(dir, `closeup-${n}.jpg`), read.prepared.jpeg);
    const ai = deps.ai;
    return streamRun(c, scan.id, "closeup", (emit, signal) =>
      runCloseup({
        ai,
        datasets: deps.datasets,
        image: read.prepared.jpeg,
        mimeType: "image/jpeg",
        emit,
        signal,
        previous: previous.summary,
        fields,
      }),
    );
  });

  app.get("/scans/:id/image", async (c) => {
    const scan = findScan(c.req.param("id"));
    if (!scan) return c.json({ error: "Scan not found" }, 404);
    return new Response(Bun.file(resolve(scansDir, scan.id, scan.imageFile)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" },
    });
  });

  // The person confirms or corrects the fields: this is the training label for the photo.
  app.patch("/scans/:id", zValidator("json", z.object({ fields: LabelFields })), (c) => {
    const id = c.req.param("id");
    if (!findScan(id)) return c.json({ error: "Scan not found" }, 404);
    deps.db.reviewScan(id, c.req.valid("json").fields);
    return c.json({ id, status: "reviewed" });
  });

  // Deterministic registry + alert matching.
  app.post("/check", zValidator("json", z.object({ fields: LabelFields })), (c) => {
    return c.json(check(c.req.valid("json").fields, deps.datasets));
  });

  // Plain-language explanation of the check, grounded in the matched alerts.
  app.post(
    "/explain",
    zValidator("json", z.object({ fields: LabelFields, mode: z.enum(["fast", "careful"]).default("careful") })),
    async (c) => {
      if (!deps.ai) return c.json({ error: "AI explanations are not configured on this server." }, 503);
      const { fields, mode } = c.req.valid("json");
      const result = check(fields, deps.datasets);
      try {
        return c.json(await deps.ai.explain(fields, result, deps.datasets, { mode }));
      } catch (error) {
        console.error("[explain] failed", error);
        return c.json({ error: "The AI explanation failed. The matched alerts are still listed above." }, 502);
      }
    },
  );

  // Public feedback on a check: was this alert about my product? was the explanation helpful?
  const Feedback = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("alert_relevance"),
      scanId: z.string().uuid().nullish(),
      alertId: z.number().int(),
      matchStrength: z.enum(["strong", "possible"]).nullish(),
      value: z.enum(["relevant", "not_relevant"]),
      comment: z.string().trim().max(500).nullish(),
    }),
    z.object({
      kind: z.literal("explanation_rating"),
      scanId: z.string().uuid().nullish(),
      value: z.enum(["helpful", "not_helpful"]),
      comment: z.string().trim().max(500).nullish(),
    }),
  ]);
  app.post("/feedback", zValidator("json", Feedback), (c) => {
    const body = c.req.valid("json");
    if (body.scanId && !findScan(body.scanId)) return c.json({ error: "Unknown scanId" }, 400);
    deps.db.insertFeedback({
      id: crypto.randomUUID(),
      createdAt: now().toISOString(),
      source: "user",
      kind: body.kind,
      scanId: body.scanId ?? null,
      reportId: null,
      alertId: body.kind === "alert_relevance" ? body.alertId : null,
      matchStrength: body.kind === "alert_relevance" ? (body.matchStrength ?? null) : null,
      value: body.value,
      comment: body.comment ?? null,
    });
    return c.json({ ok: true }, 201);
  });

  return app;
}
