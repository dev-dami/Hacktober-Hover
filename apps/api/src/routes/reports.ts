import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { ReportRow, ReportStatus } from "../db.ts";
import type { Deps } from "../deps.ts";
import { LabelFields, normalizeBatch, tokens } from "../fields.ts";
import { ImageError, prepareImage } from "../images.ts";
import { check } from "../match.ts";

const MAX_PHOTOS = 4;

const ReportInput = z.object({
  fields: LabelFields,
  description: z.string().trim().min(10, "Describe what happened (at least 10 characters).").max(3000),
  state: z.string().trim().min(2).max(60),
  lga: z.string().trim().max(80).nullish(),
  purchasePlace: z.string().trim().max(200).nullish(),
  purchaseDate: z.string().trim().max(40).nullish(),
  contact: z.string().trim().max(200).nullish(),
  scanId: z.string().uuid().nullish(),
  consent: z.literal(true, { message: "Confirm that you agree to share this report for review." }),
});

/** Reports about the same product and batch share a key. Brand tokens are sorted so word order doesn't matter. */
export function groupKey(fields: LabelFields): string {
  const name = tokens(fields.productName).sort().join("-") || "unknown-product";
  const batch = fields.batchNumber ? normalizeBatch(fields.batchNumber) : "";
  return `${name}|${batch || "no-batch"}`;
}

function evidencePack(report: ReportRow) {
  const f = report.fields;
  const line = (label: string, value: string | null | undefined) => `- ${label}: ${value || "not recorded"}`;
  const alerts = report.check.alerts;
  const markdown = [
    `# Suspected product report ${report.id}`,
    "",
    `Submitted: ${report.createdAt}`,
    "",
    "## Product details (as printed on the pack)",
    line("Product name", f.productName),
    line("Active ingredients", f.activeIngredients),
    line("Strength", f.strength),
    line("Batch number", f.batchNumber),
    line("Manufacturer", f.manufacturer),
    line("NAFDAC registration number", f.registrationNumber),
    line("Manufacturing date", f.manufacturingDate),
    line("Expiry date", f.expiryDate),
    "",
    "## Where and when it was bought",
    line("State", report.state),
    line("LGA", report.lga),
    line("Place of purchase", report.purchasePlace),
    line("Date of purchase", report.purchaseDate),
    "",
    "## What happened",
    report.description,
    "",
    "## Automated checks (for the reviewer; not a finding)",
    `- Greenbook registration check: ${report.check.registry.status}. ${report.check.registry.note}`,
    alerts.length
      ? alerts.map((a) => `- ${a.strength === "strong" ? "Close" : "Possible"} match: ${a.title} (${a.url}). ${a.reasons.join("; ")}.`).join("\n")
      : "- No matching NAFDAC alert found in the SafeMeds NG dataset.",
    "",
    `## Photos\n${report.photos.length ? report.photos.map((p, i) => `- Photo ${i + 1}: ${p}`).join("\n") : "- none"}`,
    "",
    "Submit through NAFDAC's official channels (Med Safety app or https://nafdac.gov.ng). This pack does not",
    "state that the product is counterfeit; that is for NAFDAC to determine.",
  ].join("\n");
  return { markdown, fields: f, check: report.check };
}

export function reportRoutes(deps: Deps) {
  const app = new Hono();
  const reportsDir = resolve(deps.config.storageDir, "reports");
  const now = deps.now ?? (() => new Date());

  // Public: submit a report. multipart/form-data with a JSON "report" part and up to 4 "photos".
  app.post("/reports", async (c) => {
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "Send the report as multipart/form-data." }, 400);
    let body: unknown;
    try {
      body = JSON.parse(String(form.get("report") ?? ""));
    } catch {
      return c.json({ error: "The 'report' field must be JSON." }, 400);
    }
    const parsed = ReportInput.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".") || "report"}: ${i.message}`).join("; ") }, 400);
    }
    const input = parsed.data;
    const files = form.getAll("photos").filter((p): p is File => p instanceof File && p.size > 0);
    if (files.length > MAX_PHOTOS) return c.json({ error: `Attach at most ${MAX_PHOTOS} photos.` }, 400);
    if (input.scanId && !deps.db.getScan(input.scanId)) return c.json({ error: "Unknown scanId." }, 400);

    const id = crypto.randomUUID();
    const photos: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        const prepared = await prepareImage(file);
        const name = `photo-${i + 1}.jpg`;
        await mkdir(resolve(reportsDir, id), { recursive: true });
        await Bun.write(resolve(reportsDir, id, name), prepared.jpeg);
        photos.push(name);
      }
    } catch (error) {
      if (error instanceof ImageError) return c.json({ error: error.message }, 400);
      throw error;
    }

    const report: ReportRow = {
      id,
      receiptToken: crypto.randomUUID().replaceAll("-", ""),
      createdAt: now().toISOString(),
      status: "submitted",
      scanId: input.scanId ?? null,
      fields: input.fields,
      description: input.description,
      state: input.state,
      lga: input.lga ?? null,
      purchasePlace: input.purchasePlace ?? null,
      purchaseDate: input.purchaseDate ?? null,
      contact: input.contact ?? null,
      check: check(input.fields, deps.datasets),
      groupKey: groupKey(input.fields),
      photos,
    };
    deps.db.insertReport(report);
    return c.json({ id, receiptToken: report.receiptToken, status: report.status }, 201);
  });

  // Reporter's own view, via the receipt token returned at submission.
  app.get("/reports/:id", (c) => {
    const report = deps.db.getReport(c.req.param("id"));
    if (!report || c.req.query("token") !== report.receiptToken) return c.json({ error: "Report not found" }, 404);
    const { contact: _contact, receiptToken: _token, groupKey: _key, ...visible } = report;
    return c.json({ ...visible, evidence: evidencePack(report) });
  });

  // --- Reviewer endpoints (ADMIN_TOKEN) ---
  const review = new Hono();
  review.use("*", async (c, next) => {
    if (!deps.config.adminToken) return c.json({ error: "Reviewer access is disabled (set ADMIN_TOKEN)." }, 503);
    return bearerAuth({ token: deps.config.adminToken })(c, next);
  });

  // Reports about the same product + batch, for human review. Not a public finding.
  review.get("/groups", (c) => {
    const groups = new Map<string, ReportRow[]>();
    for (const r of deps.db.listReports()) groups.set(r.groupKey, [...(groups.get(r.groupKey) ?? []), r]);
    const result = [...groups.entries()]
      .map(([key, reports]) => ({
        key,
        productName: reports[0]!.fields.productName,
        batchNumber: reports[0]!.fields.batchNumber,
        reportCount: reports.length,
        states: [...new Set(reports.map((r) => r.state))],
        firstReportedAt: reports.at(-1)!.createdAt,
        lastReportedAt: reports[0]!.createdAt,
        matchingAlerts: [...new Map(reports.flatMap((r) => r.check.alerts).map((a) => [a.alertId, { id: a.alertId, title: a.title, url: a.url }])).values()],
        statuses: Object.fromEntries(
          [...new Set(reports.map((r) => r.status))].map((s) => [s, reports.filter((r) => r.status === s).length]),
        ),
        reportIds: reports.map((r) => r.id),
      }))
      .sort((a, b) => b.reportCount - a.reportCount || b.lastReportedAt.localeCompare(a.lastReportedAt));
    return c.json({ groups: result });
  });

  review.get("/reports/:id", (c) => {
    const report = deps.db.getReport(c.req.param("id"));
    if (!report) return c.json({ error: "Report not found" }, 404);
    return c.json({ ...report, evidence: evidencePack(report) });
  });

  review.get("/reports/:id/photos/:name{photo-[0-9]+\\.jpg}", (c) => {
    const report = deps.db.getReport(c.req.param("id"));
    const name = c.req.param("name");
    if (!report || !report.photos.includes(name)) return c.json({ error: "Not found" }, 404);
    return new Response(Bun.file(resolve(reportsDir, report.id, name)), { headers: { "Content-Type": "image/jpeg" } });
  });

  review.patch("/reports/:id", async (c) => {
    const body = z
      .object({ status: z.enum(["submitted", "in_review", "forwarded_to_nafdac", "dismissed"]) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "status must be submitted, in_review, forwarded_to_nafdac or dismissed" }, 400);
    if (!deps.db.setReportStatus(c.req.param("id"), body.data.status as ReportStatus)) {
      return c.json({ error: "Report not found" }, 404);
    }
    return c.json({ id: c.req.param("id"), status: body.data.status });
  });

  app.route("/review", review);
  return app;
}
