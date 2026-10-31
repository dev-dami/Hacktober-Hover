// Offline evaluation of the label reader on real NAFDAC alert photos.
//   bun scripts/eval-reader.ts [--limit 12] [--concurrency 3] [--strategies fast,careful,agent]
//
// Ground truth is weak but real: each case is an alert with saved packaging photos and the batch /
// registration numbers the alert itself lists. A photo may not show those numbers (e.g. front of the
// pack), so "not visible" is reported separately from a wrong value. A *wrong* value, worst of all
// one the agent marked "verified", is the error that matters for safety.
//
// Writes data/eval/reader-<timestamp>.json and data/eval/latest.json (read by /api/review/metrics).

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { runVerification } from "../src/agent.ts";
import { loadConfig } from "../src/config.ts";
import { loadDatasets, type Alert } from "../src/data.ts";
import { normalizeBatch, regKey, type LabelFields } from "../src/fields.ts";
import { createGemma, type ModelCall } from "../src/gemma.ts";
import { prepareImage } from "../src/images.ts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    limit: { type: "string", default: "12" },
    concurrency: { type: "string", default: "3" },
    strategies: { type: "string", default: "fast,careful,agent" },
  },
});

const config = loadConfig();
if (!config.geminiApiKey) throw new Error("Set GEMINI_API_KEY (apps/api/.env)");
const ai = createGemma(config.geminiApiKey, config.gemmaModel);
const datasets = await loadDatasets(config.dataDir);
const alertsDir = resolve(config.dataDir, "raw/alerts");

interface Case {
  alertId: number;
  label: string;
  image: string;
  batches: string[];
  registrationNumbers: string[];
}

// One photo per alert, from alerts that list exactly one batch or registration number,
// so the expected value is unambiguous.
const cases: Case[] = datasets.alerts
  .map(({ alert }) => alert as Alert)
  .filter((a) => a.images.some((i) => i.file) && (a.batchNumbers.length === 1 || a.registrationNumbers.length === 1))
  .slice(0, Number(values.limit))
  .map((a) => ({
    alertId: a.id,
    label: a.alertNumber ?? String(a.id),
    image: a.images.find((i) => i.file)!.file!,
    batches: a.batchNumbers.length === 1 ? a.batchNumbers : [],
    registrationNumbers: a.registrationNumbers.length === 1 ? a.registrationNumbers.map((r) => r.number) : [],
  }));

type Outcome = "hit" | "wrong" | "not_visible" | "no_truth";
const score = (got: string | null | undefined, truth: string[], norm: (v: string) => string): Outcome => {
  if (!truth.length) return "no_truth";
  if (!got) return "not_visible";
  return truth.some((t) => norm(t) === norm(got)) ? "hit" : "wrong";
};

interface Row {
  case: string;
  strategy: string;
  ms: number;
  calls: number;
  failed: boolean;
  batch: Outcome;
  registration: Outcome;
  status?: string;
  verifiedButWrong?: boolean;
  read: Pick<LabelFields, "batchNumber" | "registrationNumber">;
}

async function evaluate(c: Case, strategy: string): Promise<Row> {
  const prepared = await prepareImage(new File([await Bun.file(resolve(alertsDir, c.image)).arrayBuffer()], "photo"));
  const calls: ModelCall[] = [];
  const started = Date.now();
  let fields: LabelFields | null = null;
  let status: string | undefined;
  try {
    if (strategy === "agent") {
      const summary = await runVerification({ ai, datasets, image: prepared.jpeg, mimeType: "image/jpeg", emit: () => {} });
      calls.push(...summary.modelCalls);
      fields = summary.status === "failed" ? null : summary.fields;
      status = summary.status;
    } else {
      fields = (await ai.extractLabel(prepared.jpeg, "image/jpeg", { mode: strategy as "fast" | "careful", log: (x) => calls.push(x) })).fields;
    }
  } catch {
    /* counted as failed */
  }
  const batch = score(fields?.batchNumber, c.batches, normalizeBatch);
  const registration = score(fields?.registrationNumber, c.registrationNumbers, regKey);
  return {
    case: c.label,
    strategy,
    ms: Date.now() - started,
    calls: calls.length,
    failed: fields === null,
    batch,
    registration,
    status,
    verifiedButWrong: status === "verified" && (batch === "wrong" || registration === "wrong"),
    read: { batchNumber: fields?.batchNumber ?? null, registrationNumber: fields?.registrationNumber ?? null },
  };
}

// Simple worker pool.
const jobs = values.strategies.split(",").flatMap((s) => cases.map((c) => () => evaluate(c, s.trim())));
const rows: Row[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: Number(values.concurrency) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const row = await job();
      rows.push(row);
      console.log(`${row.strategy.padEnd(8)} ${row.case.padEnd(10)} batch=${row.batch.padEnd(11)} reg=${row.registration.padEnd(11)} ${row.ms}ms${row.status ? ` ${row.status}` : ""}`);
    }
  }),
);

const summarize = (strategy: string) => {
  const r = rows.filter((x) => x.strategy === strategy);
  const field = (k: "batch" | "registration") => {
    const scored = r.filter((x) => x[k] !== "no_truth");
    const n = (o: Outcome) => scored.filter((x) => x[k] === o).length;
    return { cases: scored.length, hit: n("hit"), wrong: n("wrong"), notVisible: n("not_visible") };
  };
  const ms = r.map((x) => x.ms).sort((a, b) => a - b);
  return {
    strategy,
    runs: r.length,
    failed: r.filter((x) => x.failed).length,
    p50Ms: ms[Math.floor(ms.length / 2)] ?? null,
    p90Ms: ms[Math.floor(ms.length * 0.9)] ?? null,
    avgCalls: r.length ? Math.round((r.reduce((n, x) => n + x.calls, 0) / r.length) * 10) / 10 : null,
    batch: field("batch"),
    registration: field("registration"),
    ...(strategy === "agent"
      ? {
          verified: r.filter((x) => x.status === "verified").length,
          verifiedButWrong: r.filter((x) => x.verifiedButWrong).length,
        }
      : {}),
  };
};

const report = {
  ranAt: new Date().toISOString(),
  model: config.gemmaModel,
  cases: cases.length,
  note: "Weak labels from NAFDAC alert tables; a photo may not show the listed number (counted as not visible).",
  summary: values.strategies.split(",").map((s) => summarize(s.trim())),
  rows: rows.sort((a, b) => a.case.localeCompare(b.case) || a.strategy.localeCompare(b.strategy)),
};
const outDir = resolve(config.dataDir, "eval");
await mkdir(outDir, { recursive: true });
await Bun.write(resolve(outDir, `reader-${report.ranAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2));
await Bun.write(resolve(outDir, "latest.json"), JSON.stringify(report, null, 2));
console.table(report.summary.map((s) => ({ ...s, batch: JSON.stringify(s.batch), registration: JSON.stringify(s.registration) })));
