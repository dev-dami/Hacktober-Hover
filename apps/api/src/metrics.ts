// Metrics for the reviewer dashboard, computed from stored scans, agent runs, feedback and reports.

import { resolve } from "node:path";
import { sameValue } from "./agent.ts";
import type { Db } from "./db.ts";
import { EMPTY_FIELDS } from "./fields.ts";
import type { FieldName } from "./gemma.ts";

const FIELDS = Object.keys(EMPTY_FIELDS) as FieldName[];

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

const rate = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

function lastDays(dates: string[], days: number, today: Date) {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    buckets.set(new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10), 0);
  }
  for (const d of dates) {
    const day = d.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, buckets.get(day)! + 1);
  }
  return [...buckets].map(([date, count]) => ({ date, count }));
}

export async function computeMetrics(db: Db, dataDir: string, datasets: { alerts: number; registry: number }, today = new Date()) {
  const scans = db.listScans();
  const runs = db.listRuns();
  const verifyRuns = runs.filter((r) => r.kind === "verify");
  const reports = db.listReports();
  const feedback = db.listFeedback();

  // Reader accuracy against people's corrections: for each reviewed scan, did the model's value survive?
  const fieldAccuracy = Object.fromEntries(
    FIELDS.map((field) => {
      let compared = 0;
      let correct = 0;
      for (const s of scans) {
        if (s.status !== "reviewed" || !s.extracted || !s.corrected) continue;
        const truth = s.corrected[field];
        const read = s.extracted[field];
        if (!truth && !read) continue;
        compared++;
        if (truth && read && sameValue(field, truth, read)) correct++;
      }
      return [field, { compared, accuracy: rate(correct, compared) }];
    }),
  );

  const latencies = verifyRuns.map((r) => r.ms).sort((a, b) => a - b);
  const calls = runs.flatMap((r) => r.summary.modelCalls);
  const escalations = verifyRuns.flatMap((r) => r.summary.escalations.map((e) => e.split(":")[0]!));

  const relevance = feedback.filter((f) => f.kind === "alert_relevance");
  const verdicts = feedback.filter((f) => f.kind === "alert_verdict");
  const precision = (rows: typeof feedback, positive: string) =>
    Object.fromEntries(
      ["strong", "possible"].map((s) => {
        const subset = rows.filter((r) => r.matchStrength === s);
        return [s, { n: subset.length, precision: rate(subset.filter((r) => r.value === positive).length, subset.length) }];
      }),
    );
  const ratings = feedback.filter((f) => f.kind === "explanation_rating");

  const finalResults = verifyRuns.map((r) => r.summary.result).filter((r) => r !== null);
  const groups = new Map<string, number>();
  for (const r of reports) groups.set(r.groupKey, (groups.get(r.groupKey) ?? 0) + 1);

  let offlineEval: unknown = null;
  const evalFile = Bun.file(resolve(dataDir, "eval/latest.json"));
  if (await evalFile.exists()) offlineEval = await evalFile.json();

  return {
    generatedAt: today.toISOString(),
    data: { alerts: datasets.alerts, registeredProducts: datasets.registry },
    usage: {
      scans: scans.length,
      reviewedScans: scans.filter((s) => s.status === "reviewed").length,
      reports: reports.length,
      scansPerDay: lastDays(scans.map((s) => s.createdAt), 14, today),
      reportsPerDay: lastDays(reports.map((r) => r.createdAt), 14, today),
    },
    agent: {
      runs: verifyRuns.length,
      statuses: tally(verifyRuns.map((r) => r.status)),
      latencyMs: { p50: percentile(latencies, 50), p90: percentile(latencies, 90) },
      avgModelCalls: verifyRuns.length ? Math.round((verifyRuns.reduce((n, r) => n + r.summary.modelCalls.length, 0) / verifyRuns.length) * 10) / 10 : null,
      escalations: tally(escalations),
      modelCallFailureRate: rate(calls.filter((c) => !c.ok).length, calls.length),
      callsByTask: Object.fromEntries(
        Object.entries(tally(calls.map((c) => `${c.task}:${c.mode}`))).map(([k, n]) => {
          const ms = calls.filter((c) => `${c.task}:${c.mode}` === k).map((c) => c.ms).sort((a, b) => a - b);
          return [k, { n, p50Ms: percentile(ms, 50) }];
        }),
      ),
    },
    reader: { fieldAccuracy, offlineEval },
    checks: {
      outcomes: tally(
        finalResults.map((r) => (r.alerts.some((a) => a.strength === "strong") ? "strong_match" : r.alerts.length ? "possible_match" : "no_match")),
      ),
      registry: tally(finalResults.map((r) => r.registry.status)),
    },
    feedback: {
      userAlertRelevance: precision(relevance, "relevant"),
      reviewerAlertVerdicts: precision(verdicts, "confirmed"),
      explanationHelpful: { n: ratings.length, rate: rate(ratings.filter((r) => r.value === "helpful").length, ratings.length) },
    },
    reports: {
      statuses: tally(reports.map((r) => r.status)),
      byState: tally(reports.map((r) => r.state)),
      groups: groups.size,
      groupsWithMultipleReports: [...groups.values()].filter((n) => n > 1).length,
      submissions: tally(db.listSubmissions().map((s) => s.status)),
    },
  };
}
