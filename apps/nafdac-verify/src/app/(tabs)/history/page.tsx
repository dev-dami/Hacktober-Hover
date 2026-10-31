import type { Metadata } from "next";
import { CheckList } from "@/components/app/recent-checks";
import { Page } from "@/components/app/ui";

export const metadata: Metadata = { title: "History · NAFDAC Verify" };

export default function HistoryPage() {
  return (
    <Page className="gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">History</h1>
        <p className="text-sm text-ink-muted">Checks you have run on this device.</p>
      </div>
      <CheckList limit={20} />
    </Page>
  );
}
