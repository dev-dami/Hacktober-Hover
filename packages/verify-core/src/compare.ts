// Deterministic comparison of scanned packaging fields against a reference record.
// The training generator uses this to label examples, so labels always follow these rules.

import type { ProductRecord } from "./schema";

export const UNREADABLE = "[unreadable]";

export type Label = "record_match" | "record_mismatch" | "unverified" | "not_found";
export type Warning =
  | "missing_registration_number"
  | "unreadable_text"
  | "expired_packaging"
  | "registration_not_active";

/** Fields read off the packaging. null = not printed, UNREADABLE = printed but illegible. */
export interface ScannedLabel {
  productName: string | null;
  registrationNumber: string | null;
  manufacturer: string | null;
  activeIngredients: string | null;
  strength: string | null;
  expiryDate: string | null;
}

export type Reference =
  | { kind: "record"; record: ProductRecord }
  | { kind: "not_found"; query: string }
  | { kind: "not_checked" };

export interface Verdict {
  label: Label;
  reason: string;
  warnings: Warning[];
}

export const COMPARED_FIELDS = {
  registrationNumber: "Registration number",
  productName: "Product name",
  manufacturer: "Manufacturer",
  activeIngredients: "Active ingredients",
  strength: "Strength",
} as const;
export type ComparedField = keyof typeof COMPARED_FIELDS;

// Statuses treated as currently registered. Anything else non-empty raises a warning.
const ACTIVE_STATUSES = new Set(["active", "approved", "registered", "valid", "current"]);

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s.,]+/g, "");
}

export function normalizeRegistrationNumber(value: string): string {
  return value.toUpperCase().replace(/[‐-―]/g, "-").replace(/\s+/g, "");
}

export function normalizeIngredients(value: string): string {
  return value.split(/[;,+]/).map(normalizeText).filter(Boolean).sort().join("|");
}

export function referenceValue(record: ProductRecord, field: ComparedField): string | null {
  if (field === "activeIngredients") {
    return record.activeIngredients.length > 0 ? record.activeIngredients.join("; ") : null;
  }
  return record[field];
}

export function fieldsEqual(field: ComparedField, a: string, b: string): boolean {
  if (field === "registrationNumber") {
    return normalizeRegistrationNumber(a) === normalizeRegistrationNumber(b);
  }
  if (field === "activeIngredients") return normalizeIngredients(a) === normalizeIngredients(b);
  return normalizeText(a) === normalizeText(b);
}

/** True when the expiry (YYYY-MM or YYYY-MM-DD) is before scanDate (YYYY-MM-DD). */
export function isExpired(expiry: string, scanDate: string): boolean {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(expiry.trim());
  if (!match) return false;
  const [, year = "", month = "", day] = match;
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return `${year}-${month}-${day ?? String(lastDay).padStart(2, "0")}` < scanDate;
}

export function isInactiveStatus(status: string | null): boolean {
  return !!status && !ACTIVE_STATUSES.has(status.trim().toLowerCase());
}

function joinNames(names: string[]): string {
  const [first = "", ...rest] = names;
  const tail = rest.map((n) => n.toLowerCase());
  if (tail.length === 0) return first;
  return `${[first, ...tail.slice(0, -1)].join(", ")} and ${tail.at(-1)}`;
}

export function compareLabel(scanned: ScannedLabel, reference: Reference, scanDate: string): Verdict {
  const warnings: Warning[] = [];
  if (!scanned.registrationNumber) warnings.push("missing_registration_number");
  if (Object.values(scanned).includes(UNREADABLE)) warnings.push("unreadable_text");
  if (scanned.expiryDate && scanned.expiryDate !== UNREADABLE && isExpired(scanned.expiryDate, scanDate)) {
    warnings.push("expired_packaging");
  }
  if (reference.kind === "record" && isInactiveStatus(reference.record.approvalStatus)) {
    warnings.push("registration_not_active");
  }

  if (reference.kind === "not_checked") {
    return { label: "unverified", reason: "No official record was checked.", warnings };
  }
  if (reference.kind === "not_found") {
    return {
      label: "not_found",
      reason: `Official lookup returned no record for ${reference.query}.`,
      warnings,
    };
  }

  const mismatched: string[] = [];
  const unreadable: string[] = [];
  let matched = 0;
  for (const field of Object.keys(COMPARED_FIELDS) as ComparedField[]) {
    const scannedValue = scanned[field];
    const refValue = referenceValue(reference.record, field);
    if (scannedValue === UNREADABLE) {
      unreadable.push(COMPARED_FIELDS[field]);
    } else if (scannedValue && refValue) {
      if (fieldsEqual(field, scannedValue, refValue)) matched++;
      else mismatched.push(COMPARED_FIELDS[field]);
    }
  }

  if (mismatched.length > 0) {
    const verb = mismatched.length === 1 ? "differs" : "differ";
    return { label: "record_mismatch", reason: `${joinNames(mismatched)} ${verb} from reference.`, warnings };
  }
  if (matched === 0) {
    return { label: "unverified", reason: "No readable fields could be compared with the reference.", warnings };
  }
  if (unreadable.length > 0) {
    const fields = joinNames(unreadable).toLowerCase();
    return {
      label: "record_match",
      reason: `Readable fields match the reference; ${fields} could not be read.`,
      warnings,
    };
  }
  return { label: "record_match", reason: "All checked fields match the reference.", warnings };
}

export function formatCompletion(verdict: Verdict): string {
  const head = `${verdict.label}: ${verdict.reason}`;
  return verdict.warnings.length > 0 ? `${head}\nwarnings: ${verdict.warnings.join(", ")}` : head;
}
