import { z } from "zod";
import type { Label, ScannedLabel } from "@hacktober/verify-core";
import { createJsonStore, parseJson, type KeyValueStorage } from "./json-store";
import type { ScannedField } from "./extract";

const field = z.string().nullable();
const scannedLabelSchema = z.object({
  productName: field,
  registrationNumber: field,
  manufacturer: field,
  activeIngredients: field,
  strength: field,
  expiryDate: field,
});

const sessionSchema = z.object({
  source: z.enum(["demo", "photo"]),
  label: scannedLabelSchema,
  lowConfidence: z.array(
    z.enum(["productName", "registrationNumber", "manufacturer", "activeIngredients", "strength", "expiryDate"]),
  ),
});

export interface ScanSession {
  source: "demo" | "photo";
  label: ScannedLabel;
  lowConfidence: ScannedField[];
}

const LABELS = ["record_match", "record_mismatch", "unverified", "not_found"] as const satisfies readonly Label[];

const historySchema = z.array(
  z.object({
    id: z.string(),
    checkedAt: z.string(),
    productName: z.string().nullable(),
    registrationNumber: z.string().nullable(),
    label: z.enum(LABELS),
    summary: z.string(),
  }),
);

export type HistoryEntry = z.infer<typeof historySchema>[number];

const HISTORY_LIMIT = 20;
const NO_HISTORY: HistoryEntry[] = [];

function browserStorage(kind: "sessionStorage" | "localStorage"): () => KeyValueStorage | null {
  return () => (typeof window === "undefined" ? null : window[kind]);
}

function validate<T>(schema: z.ZodType<T>) {
  return (value: unknown): T | null => {
    const result = schema.safeParse(value);
    if (!result.success) console.warn("Ignoring stored data with an unexpected shape", result.error);
    return result.success ? result.data : null;
  };
}

export function createSessionStore(getStorage: () => KeyValueStorage | null) {
  return createJsonStore<ScanSession | null>({
    key: "nafdac-verify:scan",
    empty: null,
    parse: (raw) => parseJson(raw, validate(sessionSchema)),
    getStorage,
  });
}

export function createHistoryStore(getStorage: () => KeyValueStorage | null) {
  return createJsonStore<HistoryEntry[]>({
    key: "nafdac-verify:history",
    empty: NO_HISTORY,
    parse: (raw) => parseJson(raw, validate(historySchema)),
    getStorage,
  });
}

export function prependHistory(existing: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...existing].slice(0, HISTORY_LIMIT);
}

export const sessionStore = createSessionStore(browserStorage("sessionStorage"));
export const historyStore = createHistoryStore(browserStorage("localStorage"));
