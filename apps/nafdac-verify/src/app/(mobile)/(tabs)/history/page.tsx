import type { Metadata } from "next";
import { CheckList } from "@/components/app/recent-checks";
import { Page, PageHeader } from "@/components/app/ui";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <Page>
      <PageHeader title="History" subtitle="Checks you have run on this phone." />
      <CheckList limit={20} />
    </Page>
  );
}
