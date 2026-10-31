import type { Metadata } from "next";
import { ReviewForm } from "@/components/app/review-form";

export const metadata: Metadata = { title: "Check the details" };

export default function ReviewPage() {
  return <ReviewForm />;
}
