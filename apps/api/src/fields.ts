import { z } from "zod";

/** Fields read from a product label. Every field is optional: only what is printed. */
export const LabelFields = z.object({
  productName: z.string().trim().max(200).nullish(),
  activeIngredients: z.string().trim().max(300).nullish(),
  strength: z.string().trim().max(100).nullish(),
  batchNumber: z.string().trim().max(60).nullish(),
  manufacturer: z.string().trim().max(200).nullish(),
  registrationNumber: z.string().trim().max(40).nullish(),
  manufacturingDate: z.string().trim().max(40).nullish(),
  expiryDate: z.string().trim().max(40).nullish(),
});
export type LabelFields = z.infer<typeof LabelFields>;

export const EMPTY_FIELDS: LabelFields = {
  productName: null,
  activeIngredients: null,
  strength: null,
  batchNumber: null,
  manufacturer: null,
  registrationNumber: null,
  manufacturingDate: null,
  expiryDate: null,
};

/** Uppercase, strip everything but letters and digits: "Lot: 34-9R " -> "349R". */
export function normalizeBatch(value: string): string {
  return value.toUpperCase().replace(/^(?:BATCH|LOT)\s*(?:NO\.?|NUMBER)?\s*[:#]?\s*/i, "").replace(/[^A-Z0-9]/g, "");
}

/**
 * Comparison key for NAFDAC registration numbers: letters and digits only, so "04-0463",
 * "04 0463" and "04–0463" (as OCR or people write them) are the same number.
 */
export function regKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const STOPWORDS = new Set([
  "tablet", "tablets", "tab", "tabs", "capsule", "capsules", "caps", "syrup", "suspension", "injection",
  "solution", "oral", "cream", "ointment", "drops", "for", "and", "the", "with", "film", "coated", "dispersible",
  "mg", "ml", "mcg", "iu", "bp", "usp", "ltd", "limited", "plc", "pharma", "pharmaceutical", "pharmaceuticals",
  "industries", "laboratories", "labs", "company", "nigeria", "co", "inc", "pvt", "private", "group",
]);

/** Distinctive lowercase tokens (brand words, ingredient names), without dosage-form noise. */
export function tokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        // Drop numbers and dose tokens ("80mg", "5ml"): they are not distinctive.
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+(?:mg|ml|mcg|g|iu|kg|l)?$/.test(t)),
    ),
  ];
}
