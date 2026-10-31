import type { ScannedLabel } from "@hacktober/verify-core";

export type ScannedField = keyof ScannedLabel;

export type DemoPackId = "DEMO-0001" | "DEMO-0003";

export type PackSource = { kind: "demo"; id: DemoPackId } | { kind: "photo"; image: Blob };

export interface DemoPack {
  id: DemoPackId;
  title: string;
  hint: string;
  label: ScannedLabel;
}

export const DEMO_PACKS: readonly DemoPack[] = [
  {
    id: "DEMO-0001",
    title: "SampleMed 500",
    hint: "Fields match the register",
    label: {
      productName: "SampleMed 500",
      registrationNumber: "DEMO-0001",
      manufacturer: "ABC Labs Ltd",
      activeIngredients: "Paracetamol",
      strength: "500 mg",
      expiryDate: "2027-08",
    },
  },
  {
    id: "DEMO-0003",
    title: "TestaCillin 250",
    hint: "Manufacturer and strength differ",
    label: {
      productName: "TestaCillin 250",
      registrationNumber: "DEMO-0003",
      manufacturer: "Demo Pharmaceuticals Ltd",
      activeIngredients: "Amoxicillin",
      strength: "500 mg",
      expiryDate: "2026-03",
    },
  },
];

export interface Extraction {
  label: ScannedLabel;
  // Fields the reader was unsure about; the review screen highlights these next to [unreadable] ones.
  lowConfidence: ScannedField[];
}

// MOCK: swap this body for a Gemini call (@google/genai) returning the same shape; no UI changes needed.
export async function extractLabel(source: PackSource): Promise<ScannedLabel> {
  const id: DemoPackId = source.kind === "demo" ? source.id : "DEMO-0001";
  const pack = DEMO_PACKS.find((candidate) => candidate.id === id);
  if (!pack) throw new Error(`Unknown demo pack ${id}`);
  return { ...pack.label };
}

export async function extractWithConfidence(source: PackSource): Promise<Extraction> {
  const label = await extractLabel(source);
  return { label, lowConfidence: source.kind === "photo" ? ["manufacturer"] : [] };
}
