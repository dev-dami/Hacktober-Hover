import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { generate } from "../adaption/generate-training.ts";
import {
  CSV_COLUMNS,
  compareLabel,
  formatCompletion,
  isExpired,
  UNREADABLE,
  type ProductRecord,
  type ScannedLabel,
} from "@hacktober/verify-core";
import { parseCsv } from "./csv.ts";
import { loadProductsCsv } from "./products.ts";

const HEADER = CSV_COLUMNS.join(",");
const REAL_ROW =
  'Sample Tab,Paracetamol,500 mg,Tablet,a4 - 1234,"Labs, Ltd",Labs Ltd,Drug,Active,2024-01-01,https://greenbook.nafdac.gov.ng/products/1,2026-10-30,';

const reference: ProductRecord = {
  productName: "SampleMed 500",
  activeIngredients: ["Paracetamol"],
  strength: "500 mg",
  dosageForm: "Tablet",
  registrationNumber: "A4-1234",
  manufacturer: "ABC Labs Ltd",
  applicant: null,
  category: "Drug",
  approvalStatus: "Active",
  approvalDate: null,
  sourceUrl: null,
  checkedAt: "2026-10-31",
  notes: null,
};
const scanned: ScannedLabel = {
  productName: "SampleMed 500",
  registrationNumber: "A4-1234",
  manufacturer: "ABC Labs Ltd",
  activeIngredients: "Paracetamol",
  strength: "500mg",
  expiryDate: "2027-06",
};
const asRecord = { kind: "record", record: reference } as const;

describe("parseCsv", () => {
  test("handles BOM, quotes, escaped quotes and CRLF", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
  test("rejects unterminated quotes", () => {
    expect(() => parseCsv('a,"b\n')).toThrow();
  });
});

describe("loadProductsCsv", () => {
  test("normalizes a valid row", () => {
    const { records, issues } = loadProductsCsv(`${HEADER}\n${REAL_ROW}\n`, { today: "2026-10-31" });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(records[0]?.registrationNumber).toBe("A4-1234");
    expect(records[0]?.manufacturer).toBe("Labs, Ltd");
    expect(records[0]?.approvalDate).toBe("2024-01-01");
  });
  test("rejects non-NAFDAC sources, future dates and duplicates", () => {
    const bad = REAL_ROW.replace("greenbook.nafdac.gov.ng", "example.com");
    const future = REAL_ROW.replace("2026-10-30", "2027-01-01").replace("a4 - 1234", "A4-9999");
    const { records, issues } = loadProductsCsv(`${HEADER}\n${REAL_ROW}\n${bad}\n${future}\n`, {
      today: "2026-10-31",
    });
    expect(records).toHaveLength(1);
    const messages = issues.map((i) => i.message).join("\n");
    expect(messages).toContain("must be an official nafdac.gov.ng page");
    expect(messages).toContain("Duplicate registration_number A4-1234");
    expect(messages).toContain("is in the future");
  });
  test("rejects missing columns", () => {
    const { issues } = loadProductsCsv("product_name,registration_number\n");
    expect(issues[0]?.message).toContain("Missing columns");
  });
});

describe("compareLabel", () => {
  test("matches despite case and spacing", () => {
    const v = compareLabel({ ...scanned, registrationNumber: "a4 - 1234", productName: "SAMPLEMED 500" }, asRecord, "2026-10-31");
    expect(formatCompletion(v)).toBe("record_match: All checked fields match the reference.");
  });
  test("reports mismatched fields", () => {
    const v = compareLabel({ ...scanned, manufacturer: "XYZ Labs Ltd" }, asRecord, "2026-10-31");
    expect(formatCompletion(v)).toBe("record_mismatch: Manufacturer differs from reference.");
  });
  test("unverified, not_found, and warnings", () => {
    expect(compareLabel(scanned, { kind: "not_checked" }, "2026-10-31").label).toBe("unverified");
    expect(compareLabel(scanned, { kind: "not_found", query: "A4-0000" }, "2026-10-31").label).toBe("not_found");
    const v = compareLabel({ ...scanned, manufacturer: UNREADABLE, expiryDate: "2026-09" }, asRecord, "2026-10-31");
    expect(v.label).toBe("record_match");
    expect(v.warnings).toEqual(["unreadable_text", "expired_packaging"]);
    const inactive = compareLabel(scanned, { kind: "record", record: { ...reference, approvalStatus: "Expired" } }, "2026-10-31");
    expect(inactive.warnings).toEqual(["registration_not_active"]);
  });
  test("expiry uses end of month", () => {
    expect(isExpired("2026-10", "2026-10-31")).toBe(false);
    expect(isExpired("2026-09", "2026-10-01")).toBe(true);
  });
});

describe("generate", () => {
  test("demo fixture produces a reproducible, product-disjoint split", async () => {
    const csv = await Bun.file(resolve(import.meta.dir, "../../data/demo/demo-products.csv")).text();
    const { records, issues } = loadProductsCsv(csv, { fixture: true, today: "2026-10-31" });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);

    const first = generate(records, 54);
    const second = generate(records, 54);
    expect(first).toEqual(second);
    expect(first.valProducts.some((p) => first.trainProducts.includes(p))).toBe(false);

    const all = [...first.train, ...first.val];
    const labels = new Set(all.map((e) => e.label));
    expect([...labels].sort()).toEqual(["not_found", "record_match", "record_mismatch", "unverified"]);
    // Every variant's label must agree with its intent.
    for (const e of all) {
      if (e.variant.endsWith("differs") || e.variant.endsWith("differ")) expect(e.label).toBe("record_mismatch");
      if (e.variant === "exact_match" || e.variant === "formatting_differences") expect(e.label).toBe("record_match");
      if (e.variant === "lookup_not_found") expect(e.label).toBe("not_found");
      if (e.variant === "expired_packaging") expect(e.completion).toContain("expired_packaging");
    }
  });
});
