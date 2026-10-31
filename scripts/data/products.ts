// Load, validate and normalize the master product CSV.

import { parseCsv } from "./csv.ts";
import {
  CSV_COLUMNS,
  normalizeRegistrationNumber,
  type CsvColumn,
  type ProductRecord,
  type RawProductRow,
} from "@hacktober/verify-core";

export interface Issue {
  level: "error" | "warning";
  row: number; // 1-based CSV row, header is row 1
  message: string;
}

export interface LoadOptions {
  /** Fixture mode: fictional demo data, no official source URL required. */
  fixture?: boolean;
  today?: string;
}

const REQUIRED: CsvColumn[] = ["product_name", "registration_number", "checked_at"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Common NAFDAC shapes: A4-1234, 04-1234, B1-1234, A11-0123, A7-1234L. Warn only; formats vary.
const REG_NO_SHAPE = /^[A-Z]{0,2}\d{1,2}-\d{3,6}[A-Z]?$/;

function emptyToNull(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed;
}

function isValidDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function loadProductsCsv(text: string, options: LoadOptions = {}) {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const issues: Issue[] = [];
  const records: ProductRecord[] = [];
  const [header, ...body] = parseCsv(text);

  if (!header) {
    issues.push({ level: "error", row: 1, message: "CSV is empty; expected a header row" });
    return { records, issues };
  }
  const columns = header.map((h) => h.trim());
  const missing = CSV_COLUMNS.filter((c) => !columns.includes(c));
  const unknown = columns.filter((c) => !(CSV_COLUMNS as readonly string[]).includes(c));
  if (missing.length) issues.push({ level: "error", row: 1, message: `Missing columns: ${missing.join(", ")}` });
  if (unknown.length) issues.push({ level: "error", row: 1, message: `Unknown columns: ${unknown.join(", ")}` });
  if (missing.length || unknown.length) return { records, issues };

  const seen = new Map<string, number>();
  body.forEach((cells, index) => {
    const rowNumber = index + 2;
    const error = (message: string) => issues.push({ level: "error", row: rowNumber, message });
    const warn = (message: string) => issues.push({ level: "warning", row: rowNumber, message });

    if (cells.length !== columns.length) {
      error(`Expected ${columns.length} cells, found ${cells.length} (check for unquoted commas)`);
      return;
    }
    const raw = Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ""])) as RawProductRow;

    let ok = true;
    for (const column of REQUIRED) {
      if (!raw[column].trim()) {
        error(`${column} is required`);
        ok = false;
      }
    }

    const sourceUrl = emptyToNull(raw.source_url);
    if (!options.fixture) {
      if (!sourceUrl) {
        error("source_url is required: link the official NAFDAC page you checked");
        ok = false;
      } else {
        try {
          const host = new URL(sourceUrl).hostname;
          if (host !== "nafdac.gov.ng" && !host.endsWith(".nafdac.gov.ng")) {
            error(`source_url must be an official nafdac.gov.ng page, got ${host}`);
            ok = false;
          }
        } catch {
          error(`source_url is not a valid URL: ${sourceUrl}`);
          ok = false;
        }
      }
    }

    const checkedAt = raw.checked_at.trim();
    if (checkedAt && !isValidDate(checkedAt)) {
      error(`checked_at must be YYYY-MM-DD, got "${checkedAt}"`);
      ok = false;
    } else if (checkedAt > today) {
      error(`checked_at ${checkedAt} is in the future`);
      ok = false;
    }

    const approvalDate = emptyToNull(raw.approval_date);
    if (approvalDate && !isValidDate(approvalDate)) warn(`approval_date is not YYYY-MM-DD: "${approvalDate}"`);

    const registrationNumber = normalizeRegistrationNumber(raw.registration_number);
    if (registrationNumber && !options.fixture && !REG_NO_SHAPE.test(registrationNumber)) {
      warn(`registration_number "${registrationNumber}" has an unusual shape; double-check it`);
    }
    if (registrationNumber) {
      const firstRow = seen.get(registrationNumber);
      if (firstRow) {
        error(`Duplicate registration_number ${registrationNumber} (first seen on row ${firstRow})`);
        ok = false;
      } else {
        seen.set(registrationNumber, rowNumber);
      }
    }

    if (!ok) return;
    records.push({
      productName: emptyToNull(raw.product_name)!,
      activeIngredients: raw.active_ingredients
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
      strength: emptyToNull(raw.strength),
      dosageForm: emptyToNull(raw.dosage_form),
      registrationNumber,
      manufacturer: emptyToNull(raw.manufacturer),
      applicant: emptyToNull(raw.applicant),
      category: emptyToNull(raw.category),
      approvalStatus: emptyToNull(raw.approval_status),
      approvalDate,
      sourceUrl,
      checkedAt,
      notes: emptyToNull(raw.notes),
    });
  });

  return { records, issues };
}

export function printIssues(issues: Issue[]): void {
  for (const issue of issues) {
    const log = issue.level === "error" ? console.error : console.warn;
    log(`${issue.level.toUpperCase()} row ${issue.row}: ${issue.message}`);
  }
}
