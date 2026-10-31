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
  /**
   * Strict (default, for hand-entered data): row problems are errors.
   * Lenient (for crawled data): unusable rows are skipped with a warning.
   */
  strict?: boolean;
  today?: string;
}

const REQUIRED: CsvColumn[] = ["product_name", "registration_number", "checked_at"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Common NAFDAC shapes: A4-1234, 04-1234, B1-1234, A11-0123, A7-1234L. Warn only; formats vary.
const REG_NO_SHAPE = /^[A-Z]{0,2}\d{1,2}-\d{3,6}[A-Z]?$/;
// Placeholders seen in the register instead of a real number.
const PLACEHOLDER_REG_NO = /^(NA|N\/A|NIL|NONE|NOTAVAILABLE(YET)?|-+)$/;

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

  const strict = options.strict ?? true;
  const seenNumbers = new Map<string, number>(); // registration number -> first row
  const seenContent = new Map<string, number>(); // name|strength|manufacturer|number -> first row
  body.forEach((cells, index) => {
    const rowNumber = index + 2;
    const warn = (message: string) => issues.push({ level: "warning", row: rowNumber, message });
    const error = strict
      ? (message: string) => issues.push({ level: "error", row: rowNumber, message })
      : (message: string) => warn(`skipped: ${message}`);

    if (cells.length !== columns.length) {
      error(`Expected ${columns.length} cells, found ${cells.length} (check for unquoted commas)`);
      return;
    }
    const raw = Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ""])) as RawProductRow;
    if (PLACEHOLDER_REG_NO.test(normalizeRegistrationNumber(raw.registration_number))) {
      raw.registration_number = "";
    }
    if (/\(duplicate\)/i.test(raw.product_name)) {
      warn(`skipped: "${raw.product_name.trim()}" is marked as a duplicate entry in the source`);
      return;
    }

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
    if (!ok) return;

    // Identical repeats are dropped. Different products sharing a number are both kept:
    // the official register really contains such conflicts, and the app should surface them.
    const contentKey = [raw.product_name, raw.strength, raw.manufacturer, registrationNumber]
      .map((v) => v.toLowerCase().replace(/\s+/g, " ").trim())
      .join("|");
    const identicalRow = seenContent.get(contentKey);
    if (identicalRow) {
      warn(`skipped: identical to row ${identicalRow} (${registrationNumber})`);
      return;
    }
    seenContent.set(contentKey, rowNumber);
    const sharedRow = seenNumbers.get(registrationNumber);
    if (sharedRow) {
      warn(`registration_number ${registrationNumber} is shared with a different product on row ${sharedRow}; both kept`);
    } else {
      seenNumbers.set(registrationNumber, rowNumber);
    }

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
