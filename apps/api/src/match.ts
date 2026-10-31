// Deterministic checks of scanned label fields against the official datasets.
// The AI never decides these results; it only explains them afterwards.

import { normalizeRegistrationNumber, normalizeText } from "../../../scripts/data/compare.ts";
import type { Datasets, IndexedAlert, ProductRecord } from "./data.ts";
import { normalizeBatch, tokens, type LabelFields } from "./fields.ts";

export type MatchStrength = "strong" | "possible";

export interface AlertMatch {
  alertId: number;
  score: number;
  strength: MatchStrength;
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

export type RegistryStatus =
  | "not_provided" // no registration number on the label
  | "not_in_greenbook" // number not in the Greenbook (may be a NAPAMS product, or fake)
  | "registered" // found, details agree
  | "registered_details_differ" // found, but the label's name/manufacturer differ
  | "registered_ambiguous"; // number maps to several different products in the register

export interface RegistryCheck {
  status: RegistryStatus;
  registrationNumber: string | null;
  records: (ProductRecord & { differences: string[] })[];
  note: string;
}

export interface CheckResult {
  registry: RegistryCheck;
  alerts: AlertMatch[];
  /** Plain-language summary. Never claims a product is genuine or counterfeit. */
  summary: string;
}

const MIN_SCORE = 30;

function overlap(scan: string[], target: Set<string>): number {
  if (scan.length === 0) return 0;
  return scan.filter((t) => target.has(t)).length / scan.length;
}

export function scoreAlert(fields: LabelFields, indexed: IndexedAlert): { score: number; reasons: string[]; strong: boolean } {
  const reasons: string[] = [];
  let score = 0;
  let strong = false;

  const batch = fields.batchNumber ? normalizeBatch(fields.batchNumber) : "";
  const nameTokens = tokens(fields.productName);
  const nameOverlap = overlap(nameTokens, indexed.nameTokens);
  const nameMatches = nameOverlap >= 0.5;

  if (batch.length >= 3 && indexed.batches.has(batch)) {
    score += nameMatches || nameTokens.length === 0 ? 55 : 25;
    reasons.push(`Batch number ${fields.batchNumber} is listed in this alert`);
    strong = nameMatches;
  } else if (batch.length >= 4 && indexed.textTokens.has(batch)) {
    score += nameMatches ? 35 : 10;
    reasons.push(`Batch number ${fields.batchNumber} appears in this alert's text`);
    strong = nameMatches;
  }

  const reg = fields.registrationNumber ? normalizeRegistrationNumber(fields.registrationNumber) : "";
  const regHit = reg ? indexed.registrationNumbers.get(reg) : undefined;
  if (regHit) {
    score += 40;
    reasons.push(
      regHit.flaggedFake
        ? `This alert says registration number ${reg} is fake or not registered`
        : `Registration number ${reg} is mentioned in this alert`,
    );
    strong ||= regHit.flaggedFake || nameMatches;
  }

  if (nameOverlap > 0) {
    score += Math.round(35 * nameOverlap);
    const matched = nameTokens.filter((t) => indexed.nameTokens.has(t));
    reasons.push(`Product name matches (${matched.join(", ")})`);
  }

  const mfrOverlap = overlap(tokens(fields.manufacturer), indexed.manufacturerTokens);
  if (mfrOverlap >= 0.5) {
    score += Math.round(15 * mfrOverlap);
    reasons.push("Manufacturer matches");
  }

  return { score, reasons, strong };
}

export function matchAlerts(fields: LabelFields, datasets: Datasets, limit = 8): AlertMatch[] {
  return datasets.alerts
    .map((indexed) => ({ indexed, ...scoreAlert(fields, indexed) }))
    .filter((m) => m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || b.indexed.alert.publishedAt.localeCompare(a.indexed.alert.publishedAt))
    .slice(0, limit)
    .map(({ indexed: { alert }, score, reasons, strong }) => ({
      alertId: alert.id,
      score,
      strength: strong ? "strong" : "possible",
      reasons,
      title: alert.title,
      url: alert.url,
      publishedAt: alert.publishedAt,
      alertNumber: alert.alertNumber,
      issueTypes: alert.issueTypes,
      productNames: alert.productNames,
      batchNumbers: alert.batchNumbers,
      imageCount: alert.images.filter((i) => i.file).length,
    }));
}

export function checkRegistry(fields: LabelFields, datasets: Datasets): RegistryCheck {
  if (!fields.registrationNumber) {
    return {
      status: "not_provided",
      registrationNumber: null,
      records: [],
      note: "No NAFDAC registration number was read from the label. Every registered product must show one.",
    };
  }
  const number = normalizeRegistrationNumber(fields.registrationNumber);
  const found = datasets.registry.get(number) ?? [];
  if (found.length === 0) {
    return {
      status: "not_in_greenbook",
      registrationNumber: number,
      records: [],
      note:
        "This number is not in the NAFDAC Greenbook (medicines register). Food, water and cosmetics are registered " +
        "in NAPAMS instead; check them at registration.nafdac.gov.ng. For a medicine, a missing number is a warning sign.",
    };
  }

  const scanName = tokens(fields.productName);
  const scanMfr = tokens(fields.manufacturer);
  const records = found.map((record) => {
    const differences: string[] = [];
    if (scanName.length && overlap(scanName, new Set(tokens(record.productName))) < 0.5) differences.push("product name");
    if (scanMfr.length && record.manufacturer && overlap(scanMfr, new Set(tokens(record.manufacturer))) < 0.5) {
      differences.push("manufacturer");
    }
    return { ...record, differences };
  });

  const distinctProducts = new Set(found.map((r) => normalizeText(r.productName))).size;
  if (distinctProducts > 1) {
    return {
      status: "registered_ambiguous",
      registrationNumber: number,
      records,
      note: "The register lists this number for more than one product, so it cannot confirm which product it belongs to.",
    };
  }
  const differs = records.every((r) => r.differences.length > 0);
  return {
    status: differs ? "registered_details_differ" : "registered",
    registrationNumber: number,
    records,
    note: differs
      ? `The number is registered, but to a product whose ${records[0]!.differences.join(" and ")} differ from this label.`
      : "The number is registered and the label details agree. This confirms the registration, not that this pack is genuine.",
  };
}

export function check(fields: LabelFields, datasets: Datasets): CheckResult {
  const registry = checkRegistry(fields, datasets);
  const alerts = matchAlerts(fields, datasets);
  const strong = alerts.filter((a) => a.strength === "strong").length;
  const parts: string[] = [];
  if (strong) parts.push(`${strong} NAFDAC alert(s) closely match this product. Read them before using it.`);
  else if (alerts.length) parts.push(`${alerts.length} NAFDAC alert(s) may be related. Compare the details carefully.`);
  else parts.push("No NAFDAC alert in our dataset matches these details.");
  if (registry.status === "registered_details_differ" || registry.status === "not_in_greenbook") {
    parts.push(registry.note);
  }
  parts.push("This check cannot prove a product is genuine or fake. If in doubt, ask a pharmacist and report it.");
  return { registry, alerts, summary: parts.join(" ") };
}

export function searchAlerts(datasets: Datasets, query: string, limit = 20): IndexedAlert[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = terms.length
    ? datasets.alerts.filter((a) => terms.every((t) => a.searchText.includes(t)))
    : datasets.alerts;
  return pool.slice(0, limit);
}
