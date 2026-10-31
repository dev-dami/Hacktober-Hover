// Evidence for a NAFDAC submission about one incident group (same product + batch).
// Reporter identities and contact details never leave this module.

import type { FeedbackRow, ReportRow } from "./db.ts";

const PHONE = /(?:\+?234|0)[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{4}\b|\b\d{11}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

export function redact(text: string): string {
  return text.replace(EMAIL, "[email removed]").replace(PHONE, "[phone removed]");
}

function counts(values: (string | null)[]): string {
  const map = new Map<string, number>();
  for (const v of values) if (v) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} (${n})`).join(", ") || "not recorded";
}

/** Plain-text evidence the model drafts from; also the fallback submission when AI is unavailable. */
export function groupEvidence(reports: ReportRow[], verdicts: FeedbackRow[]): string {
  const sorted = [...reports].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const first = sorted[0]!;
  const f = first.fields;
  const variants = (key: keyof typeof f) => counts(sorted.map((r) => r.fields[key] ?? null));

  const alerts = new Map<number, { title: string; url: string; strength: string; reasons: string[] }>();
  for (const r of sorted) {
    for (const a of r.check.alerts) {
      if (!alerts.has(a.alertId)) alerts.set(a.alertId, { title: a.title, url: a.url, strength: a.strength, reasons: a.reasons });
    }
  }
  const verdictFor = (alertId: number) => {
    const v = verdicts.filter((x) => x.kind === "alert_verdict" && x.alertId === alertId);
    if (!v.length) return "not yet reviewed";
    const confirmed = v.filter((x) => x.value === "confirmed").length;
    return `reviewer confirmed relevant in ${confirmed} of ${v.length} report(s)`;
  };

  return [
    `Product name as printed: ${variants("productName")}`,
    `Batch number: ${variants("batchNumber")}`,
    `NAFDAC registration number on pack: ${variants("registrationNumber")}`,
    `Manufacturer on pack: ${variants("manufacturer")}`,
    `Strength: ${variants("strength")}`,
    `Expiry date: ${variants("expiryDate")}`,
    "",
    `Number of reports: ${sorted.length}`,
    `First report: ${first.createdAt.slice(0, 10)}; latest: ${sorted.at(-1)!.createdAt.slice(0, 10)}`,
    `States: ${counts(sorted.map((r) => r.state))}`,
    `LGAs: ${counts(sorted.map((r) => r.lga))}`,
    `Places of purchase: ${counts(sorted.map((r) => (r.purchasePlace ? redact(r.purchasePlace) : null)))}`,
    `Photos attached across reports: ${sorted.reduce((n, r) => n + r.photos.length, 0)}`,
    "",
    "What reporters observed (anonymised):",
    ...sorted.map((r, i) => `${i + 1}. ${redact(r.description).replace(/\s+/g, " ")}`),
    "",
    "Automated checks:",
    `- Greenbook registration check: ${counts(sorted.map((r) => r.check.registry.status))}`,
    `- ${first.check.registry.note}`,
    "",
    "Related NAFDAC alerts found by SafeMeds NG:",
    ...(alerts.size
      ? [...alerts].map(([id, a]) => `- ${a.title} (${a.url}); ${a.strength} match: ${a.reasons.join("; ")}; ${verdictFor(id)}`)
      : ["- none found"]),
    "",
    `Report IDs (for NAFDAC follow-up via SafeMeds NG): ${sorted.map((r) => r.id.slice(0, 8)).join(", ")}`,
  ].join("\n");
}

export function fallbackSubmission(evidence: string, productName: string | null): string {
  return [
    `# Community reports: ${productName ?? "unidentified product"}`,
    "",
    "SafeMeds NG received the public reports below about one product and batch. We have not",
    "determined whether the product is genuine; we request NAFDAC's verification.",
    "",
    "```",
    evidence,
    "```",
  ].join("\n");
}
