import type { Metadata } from "next";
import { AlertsFeed } from "@/components/app/alerts-feed";

export const metadata: Metadata = { title: "NAFDAC alerts" };

export default function AlertsPage() {
  return <AlertsFeed />;
}
