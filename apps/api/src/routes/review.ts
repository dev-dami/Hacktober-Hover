// Reviewer endpoints (ADMIN_TOKEN): incident groups, report detail, alert verdicts,
// NAFDAC submissions (draft -> approved -> sent) and the metrics dashboard.

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { resolve } from "node:path";
import { z } from "zod";
import type { ReportRow, ReportStatus } from "../db.ts";
import type { Deps } from "../deps.ts";
import { computeMetrics } from "../metrics.ts";
import { fallbackSubmission, groupEvidence } from "../submission.ts";
import { evidencePack } from "./reports.ts";

export function reviewRoutes(deps: Deps) {
  const app = new Hono();
  const reportsDir = resolve(deps.config.storageDir, "reports");
  const now = deps.now ?? (() => new Date());

  app.use("*", async (c, next) => {
    if (!deps.config.adminToken) return c.json({ error: "Reviewer access is disabled (set ADMIN_TOKEN)." }, 503);
    return bearerAuth({ token: deps.config.adminToken })(c, next);
  });

  const reportsInGroup = (key: string) => deps.db.listReports().filter((r) => r.groupKey === key);

  // Reports about the same product + batch, for human review. Not a public finding.
  app.get("/groups", (c) => {
    const groups = new Map<string, ReportRow[]>();
    for (const r of deps.db.listReports()) groups.set(r.groupKey, [...(groups.get(r.groupKey) ?? []), r]);
    const submissions = deps.db.listSubmissions();
    const result = [...groups.entries()]
      .map(([key, reports]) => ({
        key,
        productName: reports[0]!.fields.productName,
        batchNumber: reports[0]!.fields.batchNumber,
        reportCount: reports.length,
        states: [...new Set(reports.map((r) => r.state))],
        firstReportedAt: reports.at(-1)!.createdAt,
        lastReportedAt: reports[0]!.createdAt,
        matchingAlerts: [
          ...new Map(
            reports.flatMap((r) => r.check.alerts).map((a) => [a.alertId, { id: a.alertId, title: a.title, url: a.url, strength: a.strength }]),
          ).values(),
        ],
        statuses: Object.fromEntries(
          [...new Set(reports.map((r) => r.status))].map((s) => [s, reports.filter((r) => r.status === s).length]),
        ),
        reportIds: reports.map((r) => r.id),
        submission: submissions.find((s) => s.groupKey === key) ?? null,
      }))
      .sort((a, b) => b.reportCount - a.reportCount || b.lastReportedAt.localeCompare(a.lastReportedAt));
    return c.json({ groups: result });
  });

  app.get("/reports/:id", (c) => {
    const report = deps.db.getReport(c.req.param("id"));
    if (!report) return c.json({ error: "Report not found" }, 404);
    const verdicts = deps.db.listFeedback().filter((f) => f.kind === "alert_verdict" && f.reportId === report.id);
    return c.json({ ...report, evidence: evidencePack(report), verdicts });
  });

  app.get("/reports/:id/photos/:name{photo-[0-9]+\\.jpg}", (c) => {
    const report = deps.db.getReport(c.req.param("id"));
    const name = c.req.param("name");
    if (!report || !report.photos.includes(name)) return c.json({ error: "Not found" }, 404);
    return new Response(Bun.file(resolve(reportsDir, report.id, name)), { headers: { "Content-Type": "image/jpeg" } });
  });

  app.patch(
    "/reports/:id",
    zValidator("json", z.object({ status: z.enum(["submitted", "in_review", "forwarded_to_nafdac", "dismissed"]) })),
    (c) => {
      const status = c.req.valid("json").status as ReportStatus;
      if (!deps.db.setReportStatus(c.req.param("id"), status)) return c.json({ error: "Report not found" }, 404);
      return c.json({ id: c.req.param("id"), status });
    },
  );

  // Reviewer verdict on a matched alert: the ground truth for match quality.
  app.post(
    "/reports/:id/alerts/:alertId/verdict",
    zValidator("json", z.object({ value: z.enum(["confirmed", "rejected"]), comment: z.string().trim().max(500).nullish() })),
    (c) => {
      const report = deps.db.getReport(c.req.param("id"));
      const alertId = Number(c.req.param("alertId"));
      const match = report?.check.alerts.find((a) => a.alertId === alertId);
      if (!report || !match) return c.json({ error: "No such alert on this report" }, 404);
      const { value, comment } = c.req.valid("json");
      deps.db.insertFeedback({
        id: crypto.randomUUID(),
        createdAt: now().toISOString(),
        source: "reviewer",
        kind: "alert_verdict",
        scanId: report.scanId,
        reportId: report.id,
        alertId,
        matchStrength: match.strength,
        value,
        comment: comment ?? null,
      });
      return c.json({ ok: true }, 201);
    },
  );

  // --- NAFDAC submissions ---

  // Draft (or redraft) a submission for an incident group. Gemma drafts from anonymised evidence;
  // without AI the evidence itself is used. Nothing is sent automatically.
  app.post("/groups/:key/submission", async (c) => {
    const key = c.req.param("key");
    const reports = reportsInGroup(key);
    if (!reports.length) return c.json({ error: "Group not found" }, 404);
    const verdicts = deps.db.listFeedback().filter((f) => reports.some((r) => r.id === f.reportId));
    const evidence = groupEvidence(reports, verdicts);
    let markdown = fallbackSubmission(evidence, reports[0]!.fields.productName ?? null);
    let model: string | null = null;
    if (deps.ai) {
      try {
        markdown = await deps.ai.draftSubmission(evidence, { mode: "careful" });
        model = deps.ai.model;
      } catch (error) {
        console.error("[submission] draft failed, using template", error);
      }
    }
    const stamp = now().toISOString();
    const submission = {
      id: crypto.randomUUID(),
      groupKey: key,
      createdAt: stamp,
      updatedAt: stamp,
      status: "draft" as const,
      markdown,
      model,
      reportIds: reports.map((r) => r.id),
      sentNote: null,
    };
    deps.db.insertSubmission(submission);
    return c.json({ ...submission, evidence }, 201);
  });

  app.get("/submissions", (c) => c.json({ submissions: deps.db.listSubmissions(c.req.query("group")) }));

  app.get("/submissions/:id", (c) => {
    const s = deps.db.getSubmission(c.req.param("id"));
    return s ? c.json(s) : c.json({ error: "Submission not found" }, 404);
  });

  // Edit while draft; approve; then mark sent once the reviewer has submitted it to NAFDAC.
  app.patch(
    "/submissions/:id",
    zValidator(
      "json",
      z.object({
        markdown: z.string().min(20).max(20_000).optional(),
        status: z.enum(["draft", "approved", "sent"]).optional(),
        sentNote: z.string().trim().max(500).optional(),
      }),
    ),
    (c) => {
      const current = deps.db.getSubmission(c.req.param("id"));
      if (!current) return c.json({ error: "Submission not found" }, 404);
      const body = c.req.valid("json");
      if (current.status === "sent") return c.json({ error: "Sent submissions cannot be changed." }, 409);
      if (body.markdown && current.status !== "draft" && body.status !== "draft") {
        return c.json({ error: "Move the submission back to draft before editing it." }, 409);
      }
      if (body.status === "sent" && current.status !== "approved") {
        return c.json({ error: "Approve the submission before marking it sent." }, 409);
      }
      const updated = deps.db.updateSubmission(current.id, { ...body, updatedAt: now().toISOString() });
      if (body.status === "sent") {
        for (const id of current.reportIds) deps.db.setReportStatus(id, "forwarded_to_nafdac");
      }
      return c.json(updated);
    },
  );

  app.get("/submissions/:id/export", (c) => {
    const s = deps.db.getSubmission(c.req.param("id"));
    if (!s) return c.json({ error: "Submission not found" }, 404);
    if (s.status === "draft") return c.json({ error: "Approve the submission before exporting it." }, 409);
    return new Response(s.markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="safemeds-nafdac-submission-${s.id.slice(0, 8)}.md"`,
      },
    });
  });

  app.get("/metrics", async (c) =>
    c.json(
      await computeMetrics(
        deps.db,
        deps.config.dataDir,
        { alerts: deps.datasets.alerts.length, registry: deps.datasets.registryCount },
        now(),
      ),
    ),
  );

  return app;
}
