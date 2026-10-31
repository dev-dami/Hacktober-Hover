"use client";

import Link from "next/link";
import { Check, TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { Label } from "@hacktober/verify-core";
import { formatDate } from "@/lib/format";
import { historyStore } from "@/lib/stores";
import { useStore } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import { Pill, Surface, TONES, type Tone } from "./ui";

export const VERDICT_STYLE: Record<Label, { tone: Tone; icon: LucideIcon; short: string }> = {
  record_match: { tone: "forest", icon: Check, short: "Matches" },
  record_mismatch: { tone: "coral", icon: X, short: "Differs" },
  not_found: { tone: "slate", icon: TriangleAlert, short: "Not found" },
  unverified: { tone: "amber", icon: TriangleAlert, short: "Unverified" },
};

export function CheckList({ limit }: { limit: number }) {
  const history = useStore(historyStore);

  return (
    <>
      {history.length === 0 ? (
        <Surface className="px-4 py-5 text-sm text-ink-muted">
          Checks you run on this device will show up here.
        </Surface>
      ) : (
        <Surface className="divide-y divide-surface-sunken overflow-hidden">
          {history.slice(0, limit).map((entry) => {
            const style = VERDICT_STYLE[entry.label];
            const Icon = style.icon;
            return (
              <div key={entry.id} className="flex items-center gap-3 px-4 py-3.5">
                <div
                  className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", TONES[style.tone])}
                >
                  <Icon className="size-[18px]" aria-hidden />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="truncate text-[15px] font-bold">{entry.productName ?? "Unnamed medicine"}</div>
                  <div className="truncate font-mono text-xs text-ink-muted">
                    {entry.registrationNumber ?? "No reg. number"} · {formatDate(entry.checkedAt)}
                  </div>
                </div>
                <Pill tone={style.tone}>{style.short}</Pill>
              </div>
            );
          })}
        </Surface>
      )}
    </>
  );
}

export function RecentChecks() {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Recent checks</h2>
        <Link href="/history" className="text-[13px] font-bold text-forest">
          See all
        </Link>
      </div>
      <CheckList limit={3} />
    </section>
  );
}
