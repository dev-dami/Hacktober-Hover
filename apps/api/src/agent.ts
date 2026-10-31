// Verification agent: reads a label until the key fields are confirmed, or the budget runs out.
//
// "Sure" is decided by code, never by the model's own confidence:
//   - two independent readings (fast + careful) must agree on a field, or
//   - a focused re-read must side with one of two disagreeing readings (2 of 3 votes).
// Time is spent only where there is doubt: re-reads target conflicting/unconfirmed key fields,
// and the alert search widens only when the exact check found nothing. Every match is still
// scored by the deterministic matcher in match.ts.

import { normalizeText } from "@hacktober/verify-core";
import type { Datasets } from "./data.ts";
import { EMPTY_FIELDS, normalizeBatch, regKey, type LabelFields } from "./fields.ts";
import type { Ai, FieldName, ModelCall } from "./gemma.ts";
import { check, matchAlerts, type AlertMatch, type CheckResult } from "./match.ts";

export type FieldStatus = "agreed" | "resolved" | "single_reading" | "conflict" | "missing";
export type RunStatus = "verified" | "needs_review" | "needs_photo" | "failed";

export interface Budget {
  maxModelCalls: number;
  maxMs: number;
}
export const DEFAULT_BUDGET: Budget = { maxModelCalls: 6, maxMs: 150_000 };

/** Fields that decide alert and registry matches; these must be confirmed for "verified". */
export const KEY_FIELDS: FieldName[] = ["productName", "batchNumber", "registrationNumber"];
const ALL_FIELDS = Object.keys(EMPTY_FIELDS) as FieldName[];

export type AgentEvent =
  | { type: "step"; step: string; message: string }
  | { type: "fields"; stage: "fast" | "merged"; fields: LabelFields; confidence: Partial<Record<FieldName, FieldStatus>> }
  | { type: "check"; stage: "preliminary" | "final"; result: CheckResult }
  | { type: "need_photo"; fields: FieldName[]; hint: string }
  | { type: "done"; summary: RunSummary }
  | { type: "error"; message: string };

export interface RunSummary {
  status: RunStatus;
  fields: LabelFields;
  confidence: Record<FieldName, FieldStatus>;
  notes: string | null;
  result: CheckResult | null;
  modelCalls: ModelCall[];
  ms: number;
  escalations: string[];
}

export interface Reading {
  fields: LabelFields;
  notes?: string | null;
}

/** Field equality after the normalization each field needs. */
export function sameValue(field: FieldName, a: string, b: string): boolean {
  if (field === "batchNumber") return normalizeBatch(a) === normalizeBatch(b);
  if (field === "registrationNumber") return regKey(a) === regKey(b);
  if (field === "expiryDate" || field === "manufacturingDate") return a.replace(/\D/g, "") === b.replace(/\D/g, "");
  return normalizeText(a) === normalizeText(b);
}

/** Merge two independent readings field by field. The careful reading wins formatting ties. */
export function mergeReadings(fast: LabelFields, careful: LabelFields) {
  const fields = { ...EMPTY_FIELDS };
  const confidence = {} as Record<FieldName, FieldStatus>;
  const conflicts: Partial<Record<FieldName, [string, string]>> = {};
  for (const field of ALL_FIELDS) {
    const a = fast[field] ?? null;
    const b = careful[field] ?? null;
    if (!a && !b) confidence[field] = "missing";
    else if (!a || !b) {
      fields[field] = b ?? a;
      confidence[field] = "single_reading";
    } else if (sameValue(field, a, b)) {
      fields[field] = b;
      confidence[field] = "agreed";
    } else {
      fields[field] = b;
      confidence[field] = "conflict";
      conflicts[field] = [a, b];
    }
  }
  return { fields, confidence, conflicts };
}

/** Apply a focused re-read: it confirms a single reading or breaks a tie between two. */
export function applyReread(
  merged: ReturnType<typeof mergeReadings>,
  reread: Partial<Record<FieldName, string | null>>,
) {
  for (const [field, value] of Object.entries(reread) as [FieldName, string | null][]) {
    if (!value) continue;
    const status = merged.confidence[field];
    const pair = merged.conflicts[field];
    if (status === "conflict" && pair) {
      const winner = pair.find((candidate) => sameValue(field, candidate, value));
      if (winner) {
        merged.fields[field] = winner;
        merged.confidence[field] = "resolved";
      }
    } else if (status === "single_reading" && merged.fields[field] && sameValue(field, merged.fields[field]!, value)) {
      merged.confidence[field] = "agreed";
    } else if (status === "missing") {
      merged.fields[field] = value;
      merged.confidence[field] = "single_reading";
    }
  }
}

const isSure = (s: FieldStatus) => s === "agreed" || s === "resolved";

export function runStatus(confidence: Record<FieldName, FieldStatus>): RunStatus {
  const unsure = KEY_FIELDS.filter((f) => !isSure(confidence[f]));
  if (unsure.length === 0) return "verified";
  // A missing/unconfirmed batch or registration number needs a closer photo; anything else, a human look.
  return unsure.some((f) => f !== "productName" && confidence[f] !== "conflict") ? "needs_photo" : "needs_review";
}

export function photoHint(fields: FieldName[]): string {
  const parts: string[] = [];
  if (fields.includes("batchNumber") || fields.includes("expiryDate")) {
    parts.push("the batch/lot number and expiry date (usually on an end flap, the bottle label edge or the blister foil)");
  }
  if (fields.includes("registrationNumber")) parts.push('the "NAFDAC Reg. No." on the back or side panel');
  if (fields.includes("productName")) parts.push("the front of the pack with the product name");
  return `Take a close-up, in good light and in focus, of ${parts.join(" and ")}.`;
}

export interface RunOptions {
  ai: Ai;
  datasets: Datasets;
  image: Uint8Array;
  mimeType: string;
  emit: (event: AgentEvent) => void;
  budget?: Budget;
  signal?: AbortSignal;
}

export async function runVerification({
  ai,
  datasets,
  image,
  mimeType,
  emit,
  budget = DEFAULT_BUDGET,
  signal,
}: RunOptions): Promise<RunSummary> {
  const started = Date.now();
  const modelCalls: ModelCall[] = [];
  const escalations: string[] = [];
  const deadline = AbortSignal.timeout(budget.maxMs);
  const callSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const options = (mode: "fast" | "careful") => ({ mode, signal: callSignal, log: (c: ModelCall) => modelCalls.push(c) });
  const canCall = () => modelCalls.length < budget.maxModelCalls && !callSignal.aborted;

  const finish = (summary: Omit<RunSummary, "modelCalls" | "ms" | "escalations">): RunSummary => {
    const full = { ...summary, modelCalls, ms: Date.now() - started, escalations };
    emit({ type: "done", summary: full });
    return full;
  };

  // 1. Two independent readings in parallel; show the fast one as soon as it lands.
  emit({ type: "step", step: "read", message: "Reading the label (quick and careful passes)…" });
  const fastPromise = ai.extractLabel(image, mimeType, options("fast")).then(
    (reading) => {
      emit({
        type: "fields",
        stage: "fast",
        fields: reading.fields,
        confidence: Object.fromEntries(ALL_FIELDS.map((f) => [f, reading.fields[f] ? "single_reading" : "missing"])),
      });
      emit({ type: "check", stage: "preliminary", result: check(reading.fields, datasets) });
      return reading as Reading;
    },
    () => null,
  );
  const carefulPromise = ai.extractLabel(image, mimeType, options("careful")).then(
    (r) => r as Reading,
    () => null,
  );
  const [fast, careful] = await Promise.all([fastPromise, carefulPromise]);

  if (!fast && !careful) {
    emit({ type: "error", message: "The AI could not read this photo. Enter the details by hand." });
    return finish({ status: "failed", fields: EMPTY_FIELDS, confidence: Object.fromEntries(ALL_FIELDS.map((f) => [f, "missing"])) as Record<FieldName, FieldStatus>, notes: null, result: null });
  }
  if (!fast || !careful) escalations.push("one_reading_failed");
  const merged = mergeReadings(fast?.fields ?? EMPTY_FIELDS, careful?.fields ?? EMPTY_FIELDS);
  const notes = careful?.notes ?? fast?.notes ?? null;

  // 2. Re-read only key fields that are in doubt.
  const doubtful = KEY_FIELDS.filter((f) => merged.confidence[f] === "conflict" || merged.confidence[f] === "single_reading");
  if (doubtful.length && canCall()) {
    escalations.push(`reread:${doubtful.join(",")}`);
    emit({ type: "step", step: "reread", message: `Double-checking ${doubtful.join(", ")}…` });
    try {
      applyReread(merged, await ai.rereadFields(image, mimeType, doubtful, options("careful")));
    } catch {
      /* keep the unconfirmed values; they stay flagged */
    }
  }
  emit({ type: "fields", stage: "merged", fields: merged.fields, confidence: merged.confidence });

  // 3. Deterministic check on the merged reading.
  emit({ type: "step", step: "check", message: "Checking the NAFDAC register and alerts…" });
  const result = check(merged.fields, datasets);

  // 4. Nothing matched: let the model propose other names, then score them with the same matcher.
  if (result.alerts.length === 0 && merged.fields.productName && canCall()) {
    emit({ type: "step", step: "search", message: "No direct match. Searching alerts under other names…" });
    try {
      const terms = await ai.suggestSearchTerms(merged.fields, options("fast"));
      const found = new Map<number, AlertMatch>();
      for (const term of terms) {
        for (const match of matchAlerts({ ...merged.fields, productName: term }, datasets, 5)) {
          if (!found.has(match.alertId)) {
            found.set(match.alertId, {
              ...match,
              strength: "possible",
              reasons: [...match.reasons, `Found by searching for "${term}"`],
            });
          }
        }
      }
      escalations.push(`search:${terms.length}_terms:${found.size}_found`);
      result.alerts = [...found.values()].sort((a, b) => b.score - a.score).slice(0, 5);
      if (result.alerts.length) {
        result.summary = `${result.alerts.length} NAFDAC alert(s) about related names may be relevant. Compare the details carefully. ${result.summary.replace(/^No NAFDAC alert in our dataset matches these details\. /, "")}`;
      }
    } catch {
      /* the exact check stands */
    }
  }
  emit({ type: "check", stage: "final", result });

  // 5. Still unsure about key fields: ask for a close-up instead of guessing.
  const status = runStatus(merged.confidence);
  if (status === "needs_photo") {
    const want = KEY_FIELDS.filter((f) => !isSure(merged.confidence[f]));
    emit({ type: "need_photo", fields: want, hint: photoHint(want) });
  }
  return finish({ status, fields: merged.fields, confidence: merged.confidence, notes, result });
}

/**
 * Follow-up on a close-up photo: two independent re-reads of the requested fields, merged into the
 * earlier result with the same agreement rule.
 */
export async function runCloseup({
  ai,
  datasets,
  image,
  mimeType,
  emit,
  previous,
  fields,
  signal,
}: Omit<RunOptions, "budget"> & { previous: Pick<RunSummary, "fields" | "confidence" | "notes">; fields: FieldName[] }): Promise<RunSummary> {
  const started = Date.now();
  const modelCalls: ModelCall[] = [];
  const log = (c: ModelCall) => modelCalls.push(c);
  emit({ type: "step", step: "closeup", message: `Reading ${fields.join(", ")} from the close-up…` });
  const [fast, careful] = await Promise.all([
    ai.rereadFields(image, mimeType, fields, { mode: "fast", signal, log }).catch(() => ({})),
    ai.rereadFields(image, mimeType, fields, { mode: "careful", signal, log }).catch(() => ({})),
  ]);
  const fieldsOut = { ...previous.fields };
  const confidence = { ...previous.confidence };
  for (const field of fields) {
    const a = (fast as Partial<Record<FieldName, string | null>>)[field] ?? null;
    const b = (careful as Partial<Record<FieldName, string | null>>)[field] ?? null;
    if (a && b && sameValue(field, a, b)) {
      fieldsOut[field] = b;
      confidence[field] = "agreed";
    } else if (a || b) {
      const value = (b ?? a)!;
      const earlier = previous.fields[field];
      // A close-up reading that matches the earlier photo's reading confirms it.
      fieldsOut[field] = value;
      confidence[field] = earlier && sameValue(field, earlier, value) ? "agreed" : "single_reading";
    }
  }
  emit({ type: "fields", stage: "merged", fields: fieldsOut, confidence });
  const result = check(fieldsOut, datasets);
  emit({ type: "check", stage: "final", result });
  const status = runStatus(confidence);
  const summary: RunSummary = {
    status,
    fields: fieldsOut,
    confidence,
    notes: previous.notes,
    result,
    modelCalls,
    ms: Date.now() - started,
    escalations: ["closeup"],
  };
  if (status === "needs_photo") {
    const want = KEY_FIELDS.filter((f) => !isSure(confidence[f]));
    emit({ type: "need_photo", fields: want, hint: photoHint(want) });
  }
  emit({ type: "done", summary });
  return summary;
}
