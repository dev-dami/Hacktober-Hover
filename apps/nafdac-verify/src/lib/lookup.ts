import { normalizeRegistrationNumber, normalizeText, type ProductRecord } from "@hacktober/verify-core";

export const DOSAGE_FILTERS = [
  { id: "all", label: "All" },
  { id: "tablets", label: "Tablets" },
  { id: "capsules", label: "Capsules" },
  { id: "syrups", label: "Syrups" },
] as const;

export type DosageFilter = (typeof DOSAGE_FILTERS)[number]["id"];

export function dosageGroup(form: string | null): Exclude<DosageFilter, "all"> | null {
  const value = form?.toLowerCase() ?? "";
  if (value.includes("tablet")) return "tablets";
  if (value.includes("capsule")) return "capsules";
  if (value.includes("syrup")) return "syrups";
  return null;
}

export function searchRecords(
  records: readonly ProductRecord[],
  query: string,
  filter: DosageFilter,
): ProductRecord[] {
  const text = normalizeText(query);
  const reg = normalizeRegistrationNumber(query);
  return records.filter((record) => {
    if (filter !== "all" && dosageGroup(record.dosageForm) !== filter) return false;
    if (!text) return true;
    return (
      normalizeRegistrationNumber(record.registrationNumber).includes(reg) ||
      normalizeText(record.productName).includes(text) ||
      record.activeIngredients.some((ingredient) => normalizeText(ingredient).includes(text))
    );
  });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
