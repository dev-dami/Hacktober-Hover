import type { Metadata } from "next";
import { LookupSearch } from "@/components/app/lookup-search";

export const metadata: Metadata = { title: "Lookup · NAFDAC Verify" };

export default function LookupPage() {
  return <LookupSearch />;
}
