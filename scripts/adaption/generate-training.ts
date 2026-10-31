// Generate synthetic prompt/completion examples for Adaption from verified product records.
//   bun scripts/adaption/generate-training.ts [--input <json>] [--out-dir <dir>] [--seed 54]
//
// Each record yields controlled variations (matching, altered fields, no lookup, failed lookup,
// expired / missing / unreadable packaging). Labels come from compareLabel(), never by hand.
// The split is by product, so no product appears in both train.jsonl and val.jsonl.
// These are synthetic discrepancy examples, not evidence that any real product is counterfeit.

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  compareLabel,
  formatCompletion,
  normalizeRegistrationNumber,
  normalizeText,
  UNREADABLE,
  type Label,
  type Reference,
  type ScannedLabel,
} from "@hacktober/verify-core";
import type { ProductRecord } from "@hacktober/verify-core";

export interface Example {
  prompt: string;
  completion: string;
}

interface Variant {
  name: string;
  build(ctx: VariantContext): { scanned: ScannedLabel; reference: Reference } | null;
}

type PoolField = "productName" | "manufacturer" | "registrationNumber";

/** Distinct values across all records, built once so variants don't rescan the dataset. */
interface Pools {
  values: Record<PoolField, string[]>;
  knownRegistrationNumbers: Set<string>;
}

interface VariantContext {
  record: ProductRecord;
  pools: Pools;
  rng: () => number;
  validExpiry: string;
  expiredExpiry: string;
}

/** mulberry32: small seeded PRNG so output is reproducible. */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function pick<T>(items: T[], rng: () => number): T | null {
  return items.length > 0 ? items[Math.floor(rng() * items.length)]! : null;
}

function addMonths(isoDate: string, months: number): string {
  const [year, month] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month! - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildPools(records: ProductRecord[]): Pools {
  const distinct = (field: PoolField) => [...new Set(records.map((r) => r[field]).filter((v): v is string => !!v))];
  return {
    values: {
      productName: distinct("productName"),
      manufacturer: distinct("manufacturer"),
      registrationNumber: distinct("registrationNumber"),
    },
    knownRegistrationNumbers: new Set(records.map((r) => normalizeRegistrationNumber(r.registrationNumber))),
  };
}

/** A value from another product that differs from the target's after normalization. */
function otherValue(ctx: VariantContext, field: PoolField, normalize: (v: string) => string): string | null {
  const current = ctx.record[field];
  const values = ctx.pools.values[field];
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = pick(values, ctx.rng);
    if (candidate === null) return null;
    if (!current || normalize(candidate) !== normalize(current)) return candidate;
  }
  return null;
}

function scannedFrom(record: ProductRecord, expiryDate: string): ScannedLabel {
  return {
    productName: record.productName,
    registrationNumber: record.registrationNumber,
    manufacturer: record.manufacturer,
    activeIngredients: record.activeIngredients.length ? record.activeIngredients.join("; ") : null,
    strength: record.strength,
    expiryDate,
  };
}

function doubledStrength(strength: string | null): string | null {
  if (!strength) return null;
  const match = /\d+(?:\.\d+)?/.exec(strength);
  if (!match || Number(match[0]) === 0) return null;
  return strength.replace(match[0], String(Number(match[0]) * 2));
}

/** A registration number shaped like the original but absent from the pool. */
function unknownRegistrationNumber(ctx: VariantContext): string {
  const known = ctx.pools.knownRegistrationNumbers;
  const reg = ctx.record.registrationNumber;
  const digits = /(\d+)(?!.*\d)/.exec(reg);
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = digits
      ? reg.slice(0, digits.index) +
        String(Math.floor(ctx.rng() * 10 ** digits[1]!.length)).padStart(digits[1]!.length, "0") +
        reg.slice(digits.index + digits[1]!.length)
      : `${reg}${Math.floor(ctx.rng() * 10)}`;
    if (!known.has(normalizeRegistrationNumber(candidate))) return candidate;
  }
  return `${reg}X`;
}

const record = (r: ProductRecord): Reference => ({ kind: "record", record: r });

export const VARIANTS: Variant[] = [
  {
    name: "exact_match",
    build: (ctx) => ({ scanned: scannedFrom(ctx.record, ctx.validExpiry), reference: record(ctx.record) }),
  },
  {
    name: "formatting_differences",
    build: (ctx) => {
      const scanned = scannedFrom(ctx.record, ctx.validExpiry);
      scanned.productName = ctx.record.productName.toUpperCase();
      scanned.manufacturer = ctx.record.manufacturer?.toLowerCase() ?? null;
      scanned.registrationNumber = ctx.record.registrationNumber.replace("-", " - ");
      return { scanned, reference: record(ctx.record) };
    },
  },
  {
    name: "manufacturer_differs",
    build: (ctx) => {
      const other = otherValue(ctx, "manufacturer", normalizeText);
      if (!other || !ctx.record.manufacturer) return null;
      return { scanned: { ...scannedFrom(ctx.record, ctx.validExpiry), manufacturer: other }, reference: record(ctx.record) };
    },
  },
  {
    name: "product_name_differs",
    build: (ctx) => {
      const other = otherValue(ctx, "productName", normalizeText);
      if (!other) return null;
      return { scanned: { ...scannedFrom(ctx.record, ctx.validExpiry), productName: other }, reference: record(ctx.record) };
    },
  },
  {
    name: "strength_differs",
    build: (ctx) => {
      const strength = doubledStrength(ctx.record.strength);
      if (!strength) return null;
      return { scanned: { ...scannedFrom(ctx.record, ctx.validExpiry), strength }, reference: record(ctx.record) };
    },
  },
  {
    name: "registration_number_differs",
    build: (ctx) => {
      const other = otherValue(ctx, "registrationNumber", normalizeRegistrationNumber);
      if (!other) return null;
      return {
        scanned: { ...scannedFrom(ctx.record, ctx.validExpiry), registrationNumber: other },
        reference: record(ctx.record),
      };
    },
  },
  {
    name: "manufacturer_and_name_differ",
    build: (ctx) => {
      const manufacturer = otherValue(ctx, "manufacturer", normalizeText);
      const productName = otherValue(ctx, "productName", normalizeText);
      if (!manufacturer || !productName || !ctx.record.manufacturer) return null;
      return {
        scanned: { ...scannedFrom(ctx.record, ctx.validExpiry), manufacturer, productName },
        reference: record(ctx.record),
      };
    },
  },
  {
    name: "not_checked",
    build: (ctx) => ({ scanned: scannedFrom(ctx.record, ctx.validExpiry), reference: { kind: "not_checked" } }),
  },
  {
    name: "lookup_not_found",
    build: (ctx) => {
      const reg = unknownRegistrationNumber(ctx);
      return {
        scanned: { ...scannedFrom(ctx.record, ctx.validExpiry), registrationNumber: reg },
        reference: { kind: "not_found", query: reg },
      };
    },
  },
  {
    name: "expired_packaging",
    build: (ctx) => ({ scanned: scannedFrom(ctx.record, ctx.expiredExpiry), reference: record(ctx.record) }),
  },
  {
    name: "missing_registration_number",
    build: (ctx) => ({
      scanned: { ...scannedFrom(ctx.record, ctx.validExpiry), registrationNumber: null },
      reference: { kind: "not_checked" },
    }),
  },
  {
    name: "unreadable_manufacturer",
    build: (ctx) => {
      if (!ctx.record.manufacturer) return null;
      return {
        scanned: { ...scannedFrom(ctx.record, ctx.validExpiry), manufacturer: UNREADABLE },
        reference: record(ctx.record),
      };
    },
  },
];

function line(key: string, value: string | null, fallback: string): string {
  return `- ${key}: ${value ?? fallback}`;
}

export function buildPrompt(scanned: ScannedLabel, reference: Reference, scanDate: string): string {
  const lines = [
    "Compare the scanned packaging with the NAFDAC reference record.",
    `Scan date: ${scanDate}`,
    "Scanned packaging:",
    line("product_name", scanned.productName, "(not printed)"),
    line("registration_number", scanned.registrationNumber, "(not printed)"),
    line("manufacturer", scanned.manufacturer, "(not printed)"),
    line("active_ingredients", scanned.activeIngredients, "(not printed)"),
    line("strength", scanned.strength, "(not printed)"),
    line("expiry_date", scanned.expiryDate, "(not printed)"),
  ];
  if (reference.kind === "not_checked") {
    lines.push("Reference record: none checked");
  } else if (reference.kind === "not_found") {
    lines.push(`Reference lookup: no record found for ${reference.query}`);
  } else {
    const r = reference.record;
    lines.push(`Reference record (checked ${r.checkedAt}):`);
    const fields: [string, string | null][] = [
      ["product_name", r.productName],
      ["registration_number", r.registrationNumber],
      ["manufacturer", r.manufacturer],
      ["active_ingredients", r.activeIngredients.length ? r.activeIngredients.join("; ") : null],
      ["strength", r.strength],
      ["approval_status", r.approvalStatus],
    ];
    for (const [key, value] of fields) if (value) lines.push(`- ${key}: ${value}`);
  }
  return lines.join("\n");
}

export function examplesForRecord(target: ProductRecord, pools: Pools, rng: () => number) {
  const ctx: VariantContext = {
    record: target,
    pools,
    rng,
    validExpiry: addMonths(target.checkedAt, 6 + Math.floor(rng() * 30)),
    expiredExpiry: addMonths(target.checkedAt, -(1 + Math.floor(rng() * 18))),
  };
  const out: (Example & { variant: string; label: Label })[] = [];
  for (const variant of VARIANTS) {
    const built = variant.build(ctx);
    if (!built) continue;
    const verdict = compareLabel(built.scanned, built.reference, target.checkedAt);
    out.push({
      variant: variant.name,
      label: verdict.label,
      prompt: buildPrompt(built.scanned, built.reference, target.checkedAt),
      completion: formatCompletion(verdict),
    });
  }
  return out;
}

export interface GenerateOptions {
  valFraction?: number;
  /** Sample this many target products (all when omitted). Mismatch values still come from every record. */
  maxProducts?: number;
}

export function generate(records: ProductRecord[], seed: number, options: GenerateOptions = {}) {
  const { valFraction = 0.2, maxProducts = Infinity } = options;
  const rng = createRng(seed);
  const pools = buildPools(records);
  const products = shuffle(records, rng).slice(0, maxProducts);
  // Split by registration number: products that share a number stay on the same side.
  const numbers = [...new Set(products.map((r) => normalizeRegistrationNumber(r.registrationNumber)))];
  const valCount = numbers.length >= 5 ? Math.max(1, Math.round(numbers.length * valFraction)) : 0;
  const valNumbers = new Set(numbers.slice(0, valCount));
  const isVal = (r: ProductRecord) => valNumbers.has(normalizeRegistrationNumber(r.registrationNumber));
  const valProducts = products.filter(isVal);
  const trainProducts = products.filter((r) => !isVal(r));
  // Mismatch values are drawn from all records; only the target product decides the split.
  const build = (group: ProductRecord[]) => shuffle(group.flatMap((r) => examplesForRecord(r, pools, rng)), rng);
  const ids = (group: ProductRecord[]) => group.map((r) => r.sourceUrl ?? r.registrationNumber);
  return {
    train: build(trainProducts),
    val: build(valProducts),
    trainProducts: ids(trainProducts),
    valProducts: ids(valProducts),
  };
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

if (import.meta.main) {
  const ROOT = resolve(import.meta.dir, "../..");
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      input: { type: "string", default: resolve(ROOT, "data/processed/normalized-products.json") },
      "out-dir": { type: "string", default: resolve(ROOT, "data/training") },
      seed: { type: "string", default: "54" },
      // ~12 examples per product: 40 products -> ~480 examples. Use "all" for every record.
      "max-products": { type: "string", default: "40" },
    },
  });

  const records = (await Bun.file(values.input).json()) as ProductRecord[];
  if (records.length === 0) {
    console.error(`No records in ${values.input}. Add verified rows to data/raw/nafdac-products.csv and run data:normalize.`);
    process.exit(1);
  }

  const seed = Number(values.seed);
  const maxProducts = values["max-products"] === "all" ? Infinity : Number(values["max-products"]);
  const { train, val, trainProducts, valProducts } = generate(records, seed, { maxProducts });
  const toJsonl = (items: Example[]) =>
    items.map(({ prompt, completion }) => JSON.stringify({ prompt, completion })).join("\n") + "\n";

  const outDir = values["out-dir"];
  await mkdir(outDir, { recursive: true });
  await Bun.write(resolve(outDir, "train.jsonl"), toJsonl(train));
  if (val.length) await Bun.write(resolve(outDir, "val.jsonl"), toJsonl(val));

  const manifest = {
    source: values.input,
    seed,
    max_products: values["max-products"],
    records_available: records.length,
    synthetic: true,
    note: "Synthetic discrepancy examples derived from verified records. Not evidence of real counterfeits.",
    products: { train: trainProducts, val: valProducts },
    counts: {
      train: { total: train.length, byLabel: countBy(train, (e) => e.label), byVariant: countBy(train, (e) => e.variant) },
      val: { total: val.length, byLabel: countBy(val, (e) => e.label) },
    },
  };
  await Bun.write(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`${trainProducts.length + valProducts.length} of ${records.length} products -> ${train.length} train / ${val.length} val examples in ${outDir}`);
  console.log("By label (train):", manifest.counts.train.byLabel);
  if (trainProducts.length + valProducts.length < 5) console.warn("Fewer than 5 products: no validation split was written.");
}
