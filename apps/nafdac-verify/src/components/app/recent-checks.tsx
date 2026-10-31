"use client";

import Link from "next/link";
import { Check, ShieldAlert, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { formatDate } from "@/lib/format";
import { historyStore } from "@/lib/stores";
import { useStore } from "@/lib/use-store";
import type { VerdictKind } from "@/lib/verdict";
import { IconTile, Pill, Section, Surface, type Tone } from "./ui";

export const VERDICT_STYLE: Record<VerdictKind, { tone: Tone; icon: LucideIcon; short: string }> = {
  alert: { tone: "danger", icon: ShieldAlert, short: "On alert" },
  mismatch: { tone: "danger", icon: X, short: "Differs" },
  possible_alert: { tone: "caution", icon: TriangleAlert, short: "Check alert" },
  match: { tone: "safe", icon: Check, short: "Registered" },
  not_found: { tone: "caution", icon: TriangleAlert, short: "Not found" },
  unverified: { tone: "neutral", icon: TriangleAlert, short: "Unverified" },
};

export function CheckList({ limit }: { limit: number }) {
  const history = useStore(historyStore);

  if (history.length === 0) {
    return <Surface className="p-4 text-sm text-ink-muted">Checks you run on this phone show up here.</Surface>;
  }

  return (
    <Surface className="divide-y divide-line overflow-hidden">
      {history.slice(0, limit).map((entry) => {
        const style = VERDICT_STYLE[entry.verdict];
        return (
          <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
            <IconTile icon={style.icon} tone={style.tone} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold">{entry.productName ?? "Unnamed medicine"}</span>
              <span className="truncate text-xs text-ink-muted">
                <span className="font-mono">{entry.registrationNumber ?? "No reg. no."}</span> · {formatDate(entry.checkedAt)}
              </span>
            </div>
            <Pill tone={style.tone}>{style.short}</Pill>
          </div>
        );
      })}
    </Surface>
  );
}

export function RecentChecks() {
  return (
    <Section
      title="Recent checks"
      action={
        <Link href="/history" className="text-sm font-semibold text-blue">
          See all
        </Link>
      }
    >
      <CheckList limit={3} />
    </Section>
  );
}
