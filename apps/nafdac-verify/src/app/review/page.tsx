import type { Metadata } from "next";
import { ReviewForm } from "@/components/app/review-form";

export const metadata: Metadata = { title: "Review what we read · NAFDAC Verify" };

export default function ReviewPage() {
  return <ReviewForm />;
}
