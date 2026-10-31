// Gemma 4 via the Gemini API: read label fields from photos, explain checks, draft NAFDAC submissions.
//
// Measured on 2026-10-31 with gemma-4-26b-a4b-it: a full-thinking label read took ~34 s and an
// explanation ~61 s; thinkingLevel MINIMAL cut a short text call from ~11 s to ~4 s. The API also
// returns intermittent HTTP 500s, so every call retries with backoff.
// Gemma replies are prompted JSON (not schema-enforced), so they are parsed defensively.

import { ApiError as GenAiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { EMPTY_FIELDS, LabelFields } from "./fields.ts";
import type { CheckResult } from "./match.ts";
import type { Datasets } from "./data.ts";

/** fast = minimal thinking (seconds); careful = model's default thinking (tens of seconds). */
export type Mode = "fast" | "careful";

export interface ModelCall {
  task: string;
  mode: Mode;
  ms: number;
  attempts: number;
  ok: boolean;
  thoughtTokens: number;
  outputTokens: number;
}

export interface CallOptions {
  mode?: Mode;
  signal?: AbortSignal;
  /** Receives one entry per model call (for agent traces and metrics). */
  log?: (call: ModelCall) => void;
}

export type FieldName = keyof LabelFields;

export interface Ai {
  model: string;
  extractLabel(
    image: Uint8Array,
    mimeType: string,
    options?: CallOptions,
  ): Promise<{ fields: LabelFields; notes: string | null; raw: string }>;
  /** Look again at specific fields only. Returns null for fields that are not legible. */
  rereadFields(
    image: Uint8Array,
    mimeType: string,
    fields: FieldName[],
    options?: CallOptions,
  ): Promise<Partial<Record<FieldName, string | null>>>;
  /** Other names an alert might use for this product (generic name, brand, spelling variants). */
  suggestSearchTerms(fields: LabelFields, options?: CallOptions): Promise<string[]>;
  explain(fields: LabelFields, result: CheckResult, datasets: Datasets, options?: CallOptions): Promise<Explanation>;
  /** Draft a submission to NAFDAC from an evidence summary. The reviewer edits and approves it. */
  draftSubmission(evidence: string, options?: CallOptions): Promise<string>;
}

export interface Explanation {
  text: string;
  sources: { n: number; alertId: number; title: string; url: string }[];
}

const FIELD_HINTS: Record<FieldName, string> = {
  productName: 'brand and product name, e.g. "Zinnat Suspension"',
  activeIngredients: 'separate several with "; "',
  strength: 'e.g. "125 mg/5 ml"',
  batchNumber: 'after "Batch", "Lot", "B.No" or "Lot No"',
  manufacturer: '"Manufactured by" company, not the distributor',
  registrationNumber: 'NAFDAC Reg. No. / NRN, e.g. "A4-1234"',
  manufacturingDate: "as printed",
  expiryDate: "as printed",
};

const EXTRACT_PROMPT = `You read medicine and consumer product packaging for a safety-checking app in Nigeria.
Look at the photo and copy these fields exactly as printed. Do not guess or complete partial text.
Use null for anything not visible or not readable.

Reply with only this JSON object, no other text:
{
${(Object.keys(FIELD_HINTS) as FieldName[]).map((k) => `  "${k}": string | null, // ${FIELD_HINTS[k]}`).join("\n")}
  "notes": string | null // anything unclear, damaged or suspicious about the print itself
}`;

function rereadPrompt(fields: FieldName[]) {
  return `Look carefully at this product photo, only for the fields below. Zoom in mentally on small print
(batch/lot numbers and dates are often embossed or printed on a flap, edge or label corner).
Copy each exactly as printed, character by character. If a field is not visible or you cannot read every
character with confidence, use null. Do not guess.

Reply with only this JSON object:
{
${fields.map((k) => `  "${k}": string | null, // ${FIELD_HINTS[k]}`).join("\n")}
}`;
}

/** First balanced {...} or [...] block in a model reply (handles ```json fences and chatter). */
export function extractJsonObject(reply: string, open: "{" | "[" = "{"): unknown {
  const close = open === "{" ? "}" : "]";
  const start = reply.indexOf(open);
  if (start === -1) throw new Error("Model reply contained no JSON");
  let depth = 0;
  let inString = false;
  for (let i = start; i < reply.length; i++) {
    const c = reply[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(reply.slice(start, i + 1));
  }
  throw new Error("Model reply contained unterminated JSON");
}

const cleanValue = (v: unknown) =>
  typeof v === "string" && v.trim() && !/^(null|n\/a|none|not visible|unreadable)$/i.test(v.trim()) ? v.trim() : null;

export function parseExtraction(reply: string): { fields: LabelFields; notes: string | null } {
  const raw = extractJsonObject(reply) as Record<string, unknown>;
  const candidate = Object.fromEntries(Object.keys(EMPTY_FIELDS).map((k) => [k, cleanValue(raw[k])]));
  return { fields: LabelFields.parse(candidate), notes: cleanValue(raw.notes) };
}

export function parseReread(reply: string, fields: FieldName[]): Partial<Record<FieldName, string | null>> {
  const raw = extractJsonObject(reply) as Record<string, unknown>;
  return Object.fromEntries(fields.map((f) => [f, cleanValue(raw[f])]));
}

function excerpt(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function buildExplainPrompt(fields: LabelFields, result: CheckResult, datasets: Datasets) {
  const sources = result.alerts.slice(0, 5).map((match, i) => ({
    n: i + 1,
    alertId: match.alertId,
    title: match.title,
    url: match.url,
    text: excerpt(datasets.alertsById.get(match.alertId)?.alert.text ?? "", 1500),
    reasons: match.reasons,
  }));
  const label = Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const prompt = `You help people in Nigeria understand NAFDAC safety alerts about a product they scanned.
Write for a member of the public: short, plain English, no jargon.

Rules:
- Use only the scanned details and the numbered NAFDAC sources below. Do not add outside facts.
- Cite sources as [1], [2] after the sentence they support.
- Never say the product IS fake, counterfeit or safe. Say whether the details match an alert and what that alert reported.
- Point out details that differ (e.g. a different batch number) as clearly as details that match.
- End with one practical next step (e.g. do not use it, show it to a pharmacist, report it to NAFDAC).
- At most 150 words.

Scanned label:
${label || "- (no details read)"}

Registry check: ${result.registry.status} — ${result.registry.note}

Sources:
${sources.map((s) => `[${s.n}] ${s.title}\nURL: ${s.url}\nWhy it was matched: ${s.reasons.join("; ")}\n${s.text}`).join("\n\n") || "(no matching alerts)"}`;
  return { prompt, sources: sources.map(({ n, alertId, title, url }) => ({ n, alertId, title, url })) };
}

const SUBMISSION_PROMPT = `You draft a submission from SafeMeds NG, a community reporting service, to NAFDAC
(Nigeria's National Agency for Food and Drug Administration and Control) about a group of public reports
concerning one product and batch.

Rules:
- Use only the facts in the evidence below. Do not add facts, numbers or conclusions that are not there.
- Do not state that the product is counterfeit or falsified; say what reporters observed and what the
  automated checks found, and request NAFDAC's verification.
- Keep reporters anonymous: no names, phone numbers or emails.
- Format in Markdown with these sections: Summary, Product details, Reports received (count, states,
  date range, what reporters observed), Automated checks, Related NAFDAC alerts, Request.
- At most 400 words.

Evidence:
`;

const TIMEOUT_MS: Record<Mode, number> = { fast: 60_000, careful: 180_000 };
const MAX_ATTEMPTS = 3;

export function isRetryable(error: unknown): boolean {
  if (error instanceof GenAiError) return error.status === 429 || error.status >= 500;
  // Network failures and per-attempt timeouts; caller cancellation is not retried.
  return error instanceof Error && (error.name === "TypeError" || error.name === "TimeoutError");
}

export function createGemma(apiKey: string, model: string): Ai {
  const client = new GoogleGenAI({ apiKey });

  async function generate(
    task: string,
    parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[],
    { mode = "careful", signal, log }: CallOptions = {},
  ): Promise<string> {
    const started = Date.now();
    let attempts = 0;
    let usage = { thoughtTokens: 0, outputTokens: 0 };
    try {
      for (;;) {
        attempts++;
        try {
          const timeout = AbortSignal.timeout(TIMEOUT_MS[mode]);
          const response = await client.models.generateContent({
            model,
            contents: [{ role: "user", parts }],
            config: {
              temperature: 0,
              abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
              ...(mode === "fast" ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } : {}),
            },
          });
          usage = {
            thoughtTokens: response.usageMetadata?.thoughtsTokenCount ?? 0,
            outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          };
          const text = response.text;
          if (!text) throw new Error("Gemma returned an empty reply");
          log?.({ task, mode, ms: Date.now() - started, attempts, ok: true, ...usage });
          return text;
        } catch (error) {
          if (signal?.aborted || attempts >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
          await Bun.sleep(1_000 * 3 ** (attempts - 1));
        }
      }
    } catch (error) {
      log?.({ task, mode, ms: Date.now() - started, attempts, ok: false, ...usage });
      throw error;
    }
  }

  const image = (bytes: Uint8Array, mimeType: string) => ({
    inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") },
  });

  return {
    model,
    async extractLabel(bytes, mimeType, options) {
      const raw = await generate("read_label", [image(bytes, mimeType), { text: EXTRACT_PROMPT }], options);
      return { ...parseExtraction(raw), raw };
    },
    async rereadFields(bytes, mimeType, fields, options) {
      const raw = await generate("reread_fields", [image(bytes, mimeType), { text: rereadPrompt(fields) }], options);
      return parseReread(raw, fields);
    },
    async suggestSearchTerms(fields, options) {
      const raw = await generate(
        "suggest_search_terms",
        [
          {
            text: `A product label reads: ${JSON.stringify(fields)}.
List up to 4 short alternative names a NAFDAC alert might use for this exact product: the generic
(active ingredient) name, the brand name alone, and common spelling variants. Do not list unrelated products.
Reply with only a JSON array of strings.`,
          },
        ],
        { mode: "fast", ...options },
      );
      const list = extractJsonObject(raw, "[");
      return Array.isArray(list)
        ? list.filter((t): t is string => typeof t === "string" && t.trim().length >= 3).slice(0, 4)
        : [];
    },
    async explain(fields, result, datasets, options) {
      const { prompt, sources } = buildExplainPrompt(fields, result, datasets);
      return { text: (await generate("explain", [{ text: prompt }], options)).trim(), sources };
    },
    async draftSubmission(evidence, options) {
      return (await generate("draft_submission", [{ text: SUBMISSION_PROMPT + evidence }], options)).trim();
    },
  };
}
