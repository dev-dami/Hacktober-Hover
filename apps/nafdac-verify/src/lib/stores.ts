import { z } from "zod";
import { EMPTY_FIELDS, type CheckResult, type FieldName, type FieldStatus, type LabelFields } from "./api";
import { createJsonStore, parseJson, type KeyValueStorage } from "./json-store";
import { VERDICT_KINDS } from "./verdict";

const FIELD_NAMES = [
  "productName",
  "activeIngredients",
  "strength",
  "batchNumber",
  "manufacturer",
  "registrationNumber",
  "manufacturingDate",
  "expiryDate",
] as const satisfies readonly FieldName[];

const field = z.string().nullable();
const labelFieldsSchema = z.object({
  productName: field,
  activeIngredients: field,
  strength: field,
  batchNumber: field,
  manufacturer: field,
  registrationNumber: field,
  manufacturingDate: field,
  expiryDate: field,
}) satisfies z.ZodType<LabelFields>;
const fieldName = z.enum(FIELD_NAMES);
const fieldStatus = z.enum(["agreed", "resolved", "single_reading", "conflict", "missing"]) satisfies z.ZodType<FieldStatus>;

const sessionSchema = z.object({
  scanId: z.string().nullable(),
  imageUrl: z.string().nullable(),
  fields: labelFieldsSchema,
  agentFields: labelFieldsSchema.nullable(),
  confidence: z.partialRecord(fieldName, fieldStatus),
  notes: z.string().nullable(),
  aiError: z.string().nullable(),
  needPhoto: z.object({ fields: z.array(fieldName), hint: z.string() }).nullable(),
  // Written by this app from the API response; only the shape's top level is checked.
  result: z.custom<CheckResult>((value) => typeof value === "object" && value !== null && "registry" in value).nullable(),
});

/** One scan in progress: what the reader found, what the user confirmed, and the API's check. */
export type ScanSession = z.infer<typeof sessionSchema>;

/** A session with nothing read yet: the user types the details in by hand. */
export function emptySession(): ScanSession {
  return {
    scanId: null,
    imageUrl: null,
    fields: EMPTY_FIELDS,
    agentFields: null,
    confidence: {},
    notes: null,
    aiError: null,
    needPhoto: null,
    result: null,
  };
}

const historySchema = z.array(
  z.object({
    id: z.string(),
    checkedAt: z.string(),
    productName: z.string().nullable(),
    registrationNumber: z.string().nullable(),
    verdict: z.enum(VERDICT_KINDS),
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
