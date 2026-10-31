// Client for the Medfify Hono API (apps/api).

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

export interface LabelFields {
  productName: string | null;
  activeIngredients: string | null;
  strength: string | null;
  batchNumber: string | null;
  manufacturer: string | null;
  registrationNumber: string | null;
  manufacturingDate: string | null;
  expiryDate: string | null;
}

export const EMPTY_FIELDS: LabelFields = {
  productName: null,
  activeIngredients: null,
  strength: null,
  batchNumber: null,
  manufacturer: null,
  registrationNumber: null,
  manufacturingDate: null,
  expiryDate: null,
};

export const FIELD_LABELS: Record<keyof LabelFields, string> = {
  productName: "Product name",
  activeIngredients: "Active ingredients",
  strength: "Strength",
  batchNumber: "Batch / lot number",
  manufacturer: "Manufacturer",
  registrationNumber: "NAFDAC reg. no.",
  manufacturingDate: "Manufacturing date",
  expiryDate: "Expiry date",
};

export interface ScanResponse {
  id: string;
  imageUrl: string;
  aiAvailable: boolean;
  aiError: string | null;
}

export type FieldName = keyof LabelFields;
export type FieldStatus = "agreed" | "resolved" | "single_reading" | "conflict" | "missing";
export type RunStatus = "verified" | "needs_review" | "needs_photo" | "failed";

export interface RunSummary {
  status: RunStatus;
  fields: LabelFields;
  confidence: Record<FieldName, FieldStatus>;
  notes: string | null;
  result: CheckResult | null;
  ms: number;
  escalations: string[];
  modelCalls: { task: string; mode: string; ms: number; ok: boolean }[];
}

export type AgentEvent =
  | { type: "step"; step: string; message: string }
  | { type: "fields"; stage: "fast" | "merged"; fields: LabelFields; confidence: Partial<Record<FieldName, FieldStatus>> }
  | { type: "check"; stage: "preliminary" | "final"; result: CheckResult }
  | { type: "need_photo"; fields: FieldName[]; hint: string }
  | { type: "done"; summary: RunSummary }
  | { type: "error"; message: string };

export interface AlertMatch {
  alertId: number;
  score: number;
  strength: "strong" | "possible";
  reasons: string[];
  title: string;
  url: string;
  publishedAt: string;
  alertNumber: string | null;
  issueTypes: string[];
  productNames: string[];
  batchNumbers: string[];
  imageCount: number;
}

export interface RegistryRecord {
  productName: string;
  registrationNumber: string;
  manufacturer: string | null;
  applicant: string | null;
  strength: string | null;
  approvalStatus: string | null;
  sourceUrl: string | null;
  differences: string[];
}

export interface CheckResult {
  registry: {
    status:
      | "not_provided"
      | "not_in_greenbook"
      | "registered"
      | "registered_details_differ"
      | "registered_ambiguous";
    registrationNumber: string | null;
    records: RegistryRecord[];
    note: string;
  };
  alerts: AlertMatch[];
  summary: string;
}

export interface Explanation {
  text: string;
  sources: { n: number; alertId: number; title: string; url: string }[];
}

export interface AlertSummary {
  id: number;
  alertNumber: string | null;
  title: string;
  url: string;
  publishedAt: string;
  issueTypes: string[];
  productTypes: string[];
  productNames: string[];
  batchNumbers: string[];
  imageCount: number;
}

export interface AlertDetail extends AlertSummary {
  text: string;
  manufacturers: string[];
  images: { source: string; url: string }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(`Cannot reach the Medfify API at ${API_URL}. Is it running (bun run dev:api)?`, 0);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${response.status})`, response.status);
  return body as T;
}

/** POST and read a Server-Sent Events stream (the agent's progress). Resolves when the stream ends. */
export async function streamEvents(path: string, init: RequestInit, onEvent: (event: AgentEvent) => void): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { method: "POST", ...init });
  } catch {
    throw new ApiError(`Cannot reach the Medfify API at ${API_URL}.`, 0);
  }
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error ?? `Request failed (${response.status})`, response.status);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as AgentEvent);
    }
  }
}

export const postJson = <T,>(path: string, body: unknown, headers: Record<string, string> = {}) =>
  api<T>(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

export const assetUrl = (path: string) => `${API_URL}${path}`;

/** Hands the scanned details from the scan page to the report form. */
export const DRAFT_KEY = "safemeds:report-draft";
export interface ReportDraft {
  fields: LabelFields;
  scanId: string | null;
}
export function saveDraft(draft: ReportDraft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable: the form simply starts empty */
  }
}
export function loadDraft(): ReportDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as ReportDraft) : null;
  } catch {
    return null;
  }
}

export const ISSUE_LABELS: Record<string, string> = {
  falsified: "Falsified",
  substandard: "Substandard",
  recall: "Recall",
  unregistered: "Unregistered",
  contaminated: "Contaminated",
  expired: "Expired / relabelled",
  watchlist: "Watchlist",
  illegal_marketing: "Illegal sale",
};

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}
