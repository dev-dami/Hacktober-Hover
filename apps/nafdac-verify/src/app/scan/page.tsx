import type { Metadata } from "next";
import { ScanFlow } from "@/components/app/scan-flow";

export const metadata: Metadata = { title: "Scan packaging · NAFDAC Verify" };

export default function ScanPage() {
  return <ScanFlow />;
}
