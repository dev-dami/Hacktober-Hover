// Shape of the master product dataset (data/raw/nafdac-products.csv).

export const CSV_COLUMNS = [
  "product_name",
  "active_ingredients",
  "strength",
  "dosage_form",
  "registration_number",
  "manufacturer",
  "applicant",
  "category",
  "approval_status",
  "approval_date",
  "source_url",
  "checked_at",
  "notes",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];
export type RawProductRow = Record<CsvColumn, string>;

/** A product record as copied from an official NAFDAC lookup. Unknown fields are null. */
export interface ProductRecord {
  productName: string;
  activeIngredients: string[];
  strength: string | null;
  dosageForm: string | null;
  registrationNumber: string;
  manufacturer: string | null;
  applicant: string | null;
  category: string | null;
  approvalStatus: string | null;
  approvalDate: string | null;
  sourceUrl: string | null;
  checkedAt: string;
  notes: string | null;
}
