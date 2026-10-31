import type { Metadata } from "next";
import { ResultView } from "@/components/app/result-view";

export const metadata: Metadata = { title: "Result · NAFDAC Verify" };

export default function ResultPage() {
  return <ResultView />;
}
