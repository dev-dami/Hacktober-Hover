import {
  COMPARED_FIELDS,
  UNREADABLE,
  compareLabel,
  fieldsEqual,
  normalizeRegistrationNumber,
  referenceValue,
  type ComparedField,
  type ProductRecord,
  type Reference,
  type ScannedLabel,
  type Verdict,
  type Warning,
} from "@hacktober/verify-core";

export type RowStatus = "match" | "differ" | "unreadable" | "not_printed" | "no_record";

export interface ComparisonRow {
  field: ComparedField;
  label: string;
  pack: string | null;
  record: string | null;
  status: RowStatus;
}

export interface Check {
  verdict: Verdict;
  record: ProductRecord | null;
  rows: ComparisonRow[];
  scanDate: string;
}

const ROW_LABELS: Record<ComparedField, string> = {
  registrationNumber: "Registration no.",
  productName: "Medicine name",
  manufacturer: "Manufacturer",
  activeIngredients: "Active ingredient",
  strength: "Strength",
};

export const WARNING_TEXT: Record<Warning, string> = {
  missing_registration_number: "Reg. number not printed",
  unreadable_text: "Some text unreadable",
  expired_packaging: "Pack expired",
  registration_not_active: "Registration not active",
};

export function findRecord(records: readonly ProductRecord[], registrationNumber: string): ProductRecord | null {
  const wanted = normalizeRegistrationNumber(registrationNumber);
  return records.find((record) => normalizeRegistrationNumber(record.registrationNumber) === wanted) ?? null;
}

function rowStatus(pack: string | null, record: string | null, field: ComparedField, hasRecord: boolean): RowStatus {
  if (pack === UNREADABLE) return "unreadable";
  if (!pack) return "not_printed";
  if (!hasRecord || !record) return "no_record";
  return fieldsEqual(field, pack, record) ? "match" : "differ";
}

export function runCheck(scanned: ScannedLabel, records: readonly ProductRecord[], scanDate: string): Check {
  const reg = scanned.registrationNumber;
  const lookupable = reg !== null && reg !== UNREADABLE && reg.trim() !== "";
  const record = lookupable ? findRecord(records, reg) : null;

  let reference: Reference = { kind: "not_checked" };
  if (lookupable) reference = record ? { kind: "record", record } : { kind: "not_found", query: reg };

  const rows = (Object.keys(COMPARED_FIELDS) as ComparedField[]).map((field): ComparisonRow => {
    const recordValue = record ? referenceValue(record, field) : null;
    return {
      field,
      label: ROW_LABELS[field],
      pack: scanned[field],
      record: recordValue,
      status: rowStatus(scanned[field], recordValue, field, record !== null),
    };
  });

  return { verdict: compareLabel(scanned, reference, scanDate), record, rows, scanDate };
}
