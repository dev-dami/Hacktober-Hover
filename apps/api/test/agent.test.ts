import { describe, expect, test } from "bun:test";
import {
  applyReread,
  mergeReadings,
  runCloseup,
  runStatus,
  runVerification,
  type AgentEvent,
} from "../src/agent.ts";
import { buildDatasets } from "../src/data.ts";
import { EMPTY_FIELDS, type LabelFields } from "../src/fields.ts";
import type { Ai, CallOptions, FieldName } from "../src/gemma.ts";

const fields = (f: Partial<LabelFields>): LabelFields => ({ ...EMPTY_FIELDS, ...f });
const ZINNAT = fields({ productName: "Zinnat Suspension", batchNumber: "349R", registrationNumber: "04-0463" });

const datasets = buildDatasets(
  [
    {
      id: 2,
      alertNumber: "025/2020",
      title: "Alert on falsified Zinnat Suspension 125mg/5ml circulating in Nigeria",
      publishedAt: "2020-10-27T00:00:00",
      modifiedAt: "2020-10-27T00:00:00",
      url: "https://nafdac.gov.ng/zinnat/",
      categories: [],
      issueTypes: ["falsified"],
      productTypes: ["drug"],
      fields: {},
      products: [],
      productNames: ["Zinnat Suspension 125mg/5ml"],
      batchNumbers: ["349R"],
      manufacturers: [],
      registrationNumbers: [],
      images: [],
      attachments: [],
      text: "Falsified Zinnat Suspension, Lot Number 349R.",
    },
    {
      id: 7,
      alertNumber: null,
      title: "Recall of Cefuroxime axetil oral suspension",
      publishedAt: "2021-01-01T00:00:00",
      modifiedAt: "2021-01-01T00:00:00",
      url: "https://nafdac.gov.ng/cef/",
      categories: [],
      issueTypes: ["recall"],
      productTypes: ["drug"],
      fields: {},
      products: [],
      productNames: ["Cefuroxime Axetil Suspension"],
      batchNumbers: [],
      manufacturers: [],
      registrationNumbers: [],
      images: [],
      attachments: [],
      text: "",
    },
  ],
  [],
);

/** Fake Gemma: scripted readings per mode, recorded calls. */
function scriptedAi(script: {
  fast?: LabelFields | Error;
  careful?: LabelFields | Error;
  reread?: Partial<Record<FieldName, string | null>>;
  closeupFast?: Partial<Record<FieldName, string | null>>;
  closeupCareful?: Partial<Record<FieldName, string | null>>;
  terms?: string[];
}) {
  const calls: string[] = [];
  const logCall = (task: string, o?: CallOptions) => {
    calls.push(`${task}:${o?.mode}`);
    o?.log?.({ task, mode: o?.mode ?? "careful", ms: 1, attempts: 1, ok: true, thoughtTokens: 0, outputTokens: 0 });
  };
  let rereads = 0;
  const ai: Ai = {
    model: "fake",
    async extractLabel(_i, _m, o) {
      logCall("read_label", o);
      const r = o?.mode === "fast" ? script.fast : script.careful;
      if (!r || r instanceof Error) throw r ?? new Error("no script");
      return { fields: r, notes: null, raw: "" };
    },
    async rereadFields(_i, _m, wanted, o) {
      logCall("reread_fields", o);
      rereads++;
      const source = script.closeupFast || script.closeupCareful
        ? (o?.mode === "fast" ? script.closeupFast : script.closeupCareful) ?? {}
        : script.reread ?? {};
      return Object.fromEntries(wanted.map((f) => [f, source[f] ?? null]));
    },
    async suggestSearchTerms(_f, o) {
      logCall("suggest_search_terms", o);
      return script.terms ?? [];
    },
    async explain() {
      throw new Error("unused");
    },
    async draftSubmission() {
      throw new Error("unused");
    },
  };
  return { ai, calls, rereadCount: () => rereads };
}

async function run(ai: Ai, budget?: { maxModelCalls: number; maxMs: number }) {
  const events: AgentEvent[] = [];
  const summary = await runVerification({ ai, datasets, image: new Uint8Array(), mimeType: "image/jpeg", emit: (e) => events.push(e), budget });
  return { summary, events };
}

describe("merging readings", () => {
  test("agreement after normalization; disagreement is a conflict; one-sided is a single reading", () => {
    const merged = mergeReadings(
      fields({ productName: "ZINNAT suspension", batchNumber: "Lot 349-R", registrationNumber: "04-0463" }),
      fields({ productName: "Zinnat Suspension", batchNumber: "349R", registrationNumber: "04-0468", expiryDate: "05/2027" }),
    );
    expect(merged.confidence.productName).toBe("agreed");
    expect(merged.confidence.batchNumber).toBe("agreed");
    expect(merged.confidence.registrationNumber).toBe("conflict");
    expect(merged.confidence.expiryDate).toBe("single_reading");
    expect(merged.confidence.manufacturer).toBe("missing");
  });

  test("a re-read breaks ties 2-of-3 and confirms single readings", () => {
    const merged = mergeReadings(fields({ registrationNumber: "04-0463" }), fields({ registrationNumber: "04-0468", batchNumber: "349R" }));
    applyReread(merged, { registrationNumber: "04 0463", batchNumber: "349R" });
    expect(merged.fields.registrationNumber).toBe("04-0463");
    expect(merged.confidence.registrationNumber).toBe("resolved");
    expect(merged.confidence.batchNumber).toBe("agreed");
  });

  test("status: verified only when all key fields are confirmed", () => {
    const base = mergeReadings(ZINNAT, ZINNAT).confidence;
    expect(runStatus(base)).toBe("verified");
    expect(runStatus({ ...base, batchNumber: "missing" })).toBe("needs_photo");
    expect(runStatus({ ...base, productName: "conflict" })).toBe("needs_review");
  });
});

describe("verification agent", () => {
  test("two agreeing readings: verified with no extra calls, strong alert match", async () => {
    const { ai, calls } = scriptedAi({ fast: ZINNAT, careful: ZINNAT });
    const { summary, events } = await run(ai);
    expect(summary.status).toBe("verified");
    expect(calls.sort()).toEqual(["read_label:careful", "read_label:fast"]);
    expect(summary.result?.alerts[0]?.strength).toBe("strong");
    // The fast reading is streamed before the merged one.
    const order = events.filter((e) => e.type === "fields").map((e) => (e as { stage: string }).stage);
    expect(order).toEqual(["fast", "merged"]);
    expect(events.at(-1)?.type).toBe("done");
  });

  test("disagreement on the batch triggers one targeted re-read that resolves it", async () => {
    const { ai, calls } = scriptedAi({
      fast: { ...ZINNAT, batchNumber: "349B" },
      careful: ZINNAT,
      reread: { batchNumber: "349R" },
    });
    const { summary } = await run(ai);
    expect(calls).toContain("reread_fields:careful");
    expect(summary.confidence.batchNumber).toBe("resolved");
    expect(summary.fields.batchNumber).toBe("349R");
    expect(summary.status).toBe("verified");
    expect(summary.escalations).toContain("reread:batchNumber");
  });

  test("unreadable batch: asks for a close-up instead of guessing", async () => {
    const { ai } = scriptedAi({ fast: { ...ZINNAT, batchNumber: null }, careful: { ...ZINNAT, batchNumber: null } });
    const { summary, events } = await run(ai);
    expect(summary.status).toBe("needs_photo");
    const ask = events.find((e) => e.type === "need_photo") as { fields: string[]; hint: string };
    expect(ask.fields).toEqual(["batchNumber"]);
    expect(ask.hint).toContain("batch/lot number");
  });

  test("no direct match: model-suggested names are scored by the matcher, marked possible", async () => {
    const product = fields({ productName: "Zinacef Oral", batchNumber: "X1", registrationNumber: "A4-0001" });
    const { ai, calls } = scriptedAi({ fast: product, careful: product, terms: ["Cefuroxime Axetil Suspension"] });
    const { summary } = await run(ai);
    expect(calls).toContain("suggest_search_terms:fast");
    expect(summary.result?.alerts.map((a) => a.alertId)).toEqual([7]);
    expect(summary.result?.alerts[0]?.strength).toBe("possible");
    expect(summary.result?.alerts[0]?.reasons.at(-1)).toContain("Cefuroxime");
  });

  test("one reading failing still produces a result; both failing is reported", async () => {
    const half = await run(scriptedAi({ fast: new Error("500"), careful: ZINNAT }).ai);
    expect(half.summary.status).not.toBe("failed");
    expect(half.summary.escalations).toContain("one_reading_failed");
    const none = await run(scriptedAi({ fast: new Error("500"), careful: new Error("500") }).ai);
    expect(none.summary.status).toBe("failed");
    expect(none.events.some((e) => e.type === "error")).toBe(true);
  });

  test("budget: no re-read once the call budget is spent", async () => {
    const { ai, calls } = scriptedAi({ fast: { ...ZINNAT, batchNumber: "349B" }, careful: ZINNAT, reread: { batchNumber: "349R" } });
    const { summary } = await run(ai, { maxModelCalls: 2, maxMs: 60_000 });
    expect(calls).not.toContain("reread_fields:careful");
    expect(summary.confidence.batchNumber).toBe("conflict");
    expect(summary.status).toBe("needs_review");
  });

  test("close-up: two agreeing re-reads confirm the missing field", async () => {
    const { ai } = scriptedAi({ closeupFast: { batchNumber: "349 R" }, closeupCareful: { batchNumber: "349R" } });
    const previous = { ...mergeReadings({ ...ZINNAT, batchNumber: null }, { ...ZINNAT, batchNumber: null }), notes: null };
    const events: AgentEvent[] = [];
    const summary = await runCloseup({
      ai,
      datasets,
      image: new Uint8Array(),
      mimeType: "image/jpeg",
      emit: (e) => events.push(e),
      previous,
      fields: ["batchNumber"],
    });
    expect(summary.confidence.batchNumber).toBe("agreed");
    expect(summary.status).toBe("verified");
    expect(summary.result?.alerts[0]?.alertId).toBe(2);
  });
});
