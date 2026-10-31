export type AlertType = "falsified" | "recall";
export type AlertFilter = "all" | "falsified" | "recalled";

export interface MedicineAlert {
  id: string;
  type: AlertType;
  productName: string;
  registrationNumber: string;
  issue: string;
  notice: string;
  date: string;
}

// Sample data only; the live feed will come from NAFDAC public notices.
export const SAMPLE_ALERTS: readonly MedicineAlert[] = [
  {
    id: "a1",
    type: "falsified",
    productName: "SampleMed 500",
    registrationNumber: "DEMO-0001",
    issue: "Falsified batch circulating with a copied label and wrong batch number.",
    notice: "Sample notice. Check the batch number against the pharmacy invoice and report packs that don't match.",
    date: "2026-10-12",
  },
  {
    id: "a2",
    type: "recall",
    productName: "DemoCough Syrup",
    registrationNumber: "DEMO-0002",
    issue: "Voluntary recall of one batch over a bottle sealing defect.",
    notice: "Sample notice. Stop using the affected batch and return it to the place of purchase.",
    date: "2026-10-08",
  },
  {
    id: "a3",
    type: "falsified",
    productName: "TestaCillin 250",
    registrationNumber: "DEMO-0003",
    issue: "Counterfeit capsules found without the NAFDAC registration mark.",
    notice: "Sample notice. Genuine packs carry the registration number printed on the label.",
    date: "2026-09-29",
  },
  {
    id: "a4",
    type: "recall",
    productName: "ExampleZinc 20",
    registrationNumber: "DEMO-0004",
    issue: "Recall of two batches after a dissolution test failure.",
    notice: "Sample notice. Ask your pharmacist whether your pack is from an affected batch.",
    date: "2026-09-21",
  },
];

export function filterAlerts(alerts: readonly MedicineAlert[], filter: AlertFilter): MedicineAlert[] {
  if (filter === "all") return [...alerts];
  const type: AlertType = filter === "falsified" ? "falsified" : "recall";
  return alerts.filter((alert) => alert.type === type);
}
