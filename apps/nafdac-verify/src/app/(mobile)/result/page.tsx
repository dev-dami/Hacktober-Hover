import type { Metadata } from "next";
import { ResultView } from "@/components/app/result-view";

export const metadata: Metadata = { title: "Result" };

export default function ResultPage() {
  return <ResultView />;
}
