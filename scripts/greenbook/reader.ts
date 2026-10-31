// Reader: turns Greenbook responses into plain records and master-CSV rows.

import type { RawProductRow } from "../data/schema.ts";
import { cleanText } from "../lib/html.ts";

export const BASE_URL = "https://greenbook.nafdac.gov.ng";

/** A product row from the Greenbook table endpoint, trimmed to the fields we keep. */
export interface GreenbookProduct {
  product_id: number;
  manufacturer_id: number | null;
  applicant_id: number | null;
  ingredient_id: number | null;
  product_name: string;
  ingredient_name: string | null;
  synonym: string | null;
  strength: string | null;
  form_name: string | null;
  route_name: string | null;
  NAFDAC: string | null;
  applicant_name: string | null;
  category_name: string | null;
  status: string | null;
  approval_date: string | null;
  expiry_date: string | null;
  composition: string | null;
  pack_size: string | null;
  atc: string | null;
  product_description: string | null;
}

export interface ProductsPage {
  recordsTotal: number;
  recordsFiltered: number;
  data: GreenbookProduct[];
}

const KEPT_FIELDS: (keyof GreenbookProduct)[] = [
  "product_id",
  "manufacturer_id",
  "applicant_id",
  "ingredient_id",
  "product_name",
  "ingredient_name",
  "synonym",
  "strength",
  "form_name",
  "route_name",
  "NAFDAC",
  "applicant_name",
  "category_name",
  "status",
  "approval_date",
  "expiry_date",
  "composition",
  "pack_size",
  "atc",
  "product_description",
];

export function productsPageUrl(start: number, length: number): string {
  const params = new URLSearchParams({
    draw: "1",
    start: String(start),
    length: String(length),
    "columns[0][data]": "product_id",
    "columns[0][name]": "product_id",
    "order[0][column]": "0",
    "order[0][dir]": "asc",
  });
  return `${BASE_URL}/?${params}`;
}

export function productDetailsUrl(productId: number): string {
  return `${BASE_URL}/products/details/${productId}`;
}

export function readProductsPage(json: string): ProductsPage {
  const parsed = JSON.parse(json) as { recordsTotal?: unknown; recordsFiltered?: unknown; data?: unknown };
  if (typeof parsed.recordsTotal !== "number" || !Array.isArray(parsed.data)) {
    throw new Error("Unexpected Greenbook response: missing recordsTotal or data");
  }
  const data = (parsed.data as Record<string, unknown>[]).map((row) => {
    const kept: Record<string, unknown> = {};
    for (const field of KEPT_FIELDS) {
      const value = row[field];
      kept[field] = typeof value === "string" ? value.trim() || null : (value ?? null);
    }
    if (typeof kept.product_id !== "number") throw new Error("Greenbook row without product_id");
    return kept as unknown as GreenbookProduct;
  });
  return { recordsTotal: parsed.recordsTotal, recordsFiltered: Number(parsed.recordsFiltered ?? 0), data };
}


/** Manufacturer cards on /manufacturers?page=N. */
export function readManufacturersPage(html: string): { id: number; name: string }[] {
  const cards = /\/manufacturer\/products\/(\d+)"[^>]*>\s*<div[^>]*>\s*<h5>([\s\S]*?)<\/h5>/g;
  return [...html.matchAll(cards)].map((m) => ({ id: Number(m[1]), name: cleanText(m[2] ?? "") }));
}

/** "Manufacturer Name" on a product details page (fallback when the list lacks an id). */
export function readManufacturerFromDetails(html: string): string | null {
  const text = cleanText(html);
  const match = /Manufacturer Name (.*?) Manufacturer Country/.exec(text);
  return match?.[1]?.trim() || null;
}

/** Greenbook marks some names with # and * (its own UI strips them before display). */
export function cleanProductName(name: string): string {
  return name.replace(/[#*]/g, "").replace(/\s+/g, " ").trim();
}

export function toProductRow(
  product: GreenbookProduct,
  manufacturers: ReadonlyMap<number, string>,
  checkedAt: string,
): RawProductRow {
  const manufacturer = product.manufacturer_id == null ? "" : (manufacturers.get(product.manufacturer_id) ?? "");
  return {
    product_name: cleanProductName(product.product_name),
    active_ingredients: product.ingredient_name ?? "",
    strength: product.strength ?? "",
    dosage_form: product.form_name ?? "",
    registration_number: product.NAFDAC ?? "",
    manufacturer,
    applicant: product.applicant_name ?? "",
    category: product.category_name ?? "",
    approval_status: product.status ?? "",
    approval_date: product.approval_date ?? "",
    source_url: productDetailsUrl(product.product_id),
    checked_at: checkedAt,
    notes: product.expiry_date ? `Registration expiry ${product.expiry_date}` : "",
  };
}
