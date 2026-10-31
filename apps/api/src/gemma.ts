// Gemma 4 via the Gemini API: read label fields from a photo, and explain alert matches.
// Gemma on the Gemini API is prompted for JSON as plain text (no schema-enforced output),
// so replies are parsed defensively and validated.

import { GoogleGenAI } from "@google/genai";
import { EMPTY_FIELDS, LabelFields } from "./fields.ts";
import type { CheckResult } from "./match.ts";
import type { Datasets } from "./data.ts";

export interface Ai {
  model: string;
  extractLabel(image: Uint8Array, mimeType: string): Promise<{ fields: LabelFields; notes: string | null; raw: string }>;
  explain(fields: LabelFields, result: CheckResult, datasets: Datasets): Promise<Explanation>;
}

export interface Explanation {
  text: string;
  sources: { n: number; alertId: number; title: string; url: string }[];
}

const EXTRACT_PROMPT = `You read medicine and consumer product packaging for a safety-checking app in Nigeria.
Look at the photo and copy these fields exactly as printed. Do not guess or complete partial text.
Use null for anything not visible or not readable.

Reply with only this JSON object, no other text:
{
  "productName": string | null,        // brand and product name, e.g. "Zinnat Suspension"
  "activeIngredients": string | null,  // separate several with "; "
  "strength": string | null,           // e.g. "125 mg/5 ml"
  "batchNumber": string | null,        // after "Batch", "Lot", "B.No" or "Lot No"
  "manufacturer": string | null,       // "Manufactured by" company, not the distributor
  "registrationNumber": string | null, // NAFDAC Reg. No. / NRN, e.g. "A4-1234"
  "manufacturingDate": string | null,  // as printed
  "expiryDate": string | null,         // as printed
  "notes": string | null               // anything unclear, damaged or suspicious about the print itself
}`;

/** First balanced {...} block in a model reply (handles ```json fences and chatter). */
export function extractJsonObject(reply: string): unknown {
  const start = reply.indexOf("{");
  if (start === -1) throw new Error("Model reply contained no JSON object");
  let depth = 0;
  let inString = false;
  for (let i = start; i < reply.length; i++) {
    const c = reply[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(reply.slice(start, i + 1));
  }
  throw new Error("Model reply contained an unterminated JSON object");
}

export function parseExtraction(reply: string): { fields: LabelFields; notes: string | null } {
  const raw = extractJsonObject(reply) as Record<string, unknown>;
  const clean = (v: unknown) => (typeof v === "string" && v.trim() && !/^(null|n\/a|none)$/i.test(v.trim()) ? v.trim() : null);
  const candidate = Object.fromEntries(Object.keys(EMPTY_FIELDS).map((k) => [k, clean(raw[k])]));
  return { fields: LabelFields.parse(candidate), notes: clean(raw.notes) };
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

export function createGemma(apiKey: string, model: string): Ai {
  const client = new GoogleGenAI({ apiKey });

  async function generate(parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[]) {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
      config: { temperature: 0 },
    });
    const text = response.text;
    if (!text) throw new Error("Gemma returned an empty reply");
    return text;
  }

  return {
    model,
    async extractLabel(image, mimeType) {
      const raw = await generate([
        { inlineData: { mimeType, data: Buffer.from(image).toString("base64") } },
        { text: EXTRACT_PROMPT },
      ]);
      return { ...parseExtraction(raw), raw };
    },
    async explain(fields, result, datasets) {
      const { prompt, sources } = buildExplainPrompt(fields, result, datasets);
      return { text: (await generate([{ text: prompt }])).trim(), sources };
    },
  };
}
