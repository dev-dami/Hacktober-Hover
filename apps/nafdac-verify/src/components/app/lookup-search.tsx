"use client";

import { useState } from "react";
import Link from "next/link";
import { ScanLine, Search } from "lucide-react";
import { demoRecords } from "@hacktober/verify-core";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { DOSAGE_FILTERS, initials, searchRecords, type DosageFilter } from "@/lib/lookup";
import { isInactiveStatus } from "@hacktober/verify-core";
import { cn } from "@/lib/utils";
import { Page, Pill, Surface } from "./ui";

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-9 rounded-pill border px-3.5 text-[13px] font-bold",
        active ? "border-transparent bg-ink text-white" : "border-line bg-card text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function LookupSearch() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DosageFilter>("all");
  const results = searchRecords(demoRecords, query, filter);

  return (
    <Page className="gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Lookup</h1>
        <p className="text-sm text-ink-muted">Search the register by number or name.</p>
      </div>

      <div className="flex h-[54px] items-center gap-2.5 rounded-[18px] border-[1.5px] border-forest bg-card pr-2 pl-4 shadow-[0_0_0_4px_var(--forest-tint)]">
        <Search className="size-5 text-ink-muted" aria-hidden />
        <label htmlFor="lookup-query" className="sr-only">
          Search medicines
        </label>
        <Input
          id="lookup-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. DEMO-0001 or Paracetamol"
          autoComplete="off"
          className="h-full flex-1 border-0 bg-transparent px-0 font-mono text-[15px] font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Link
          href="/scan"
          aria-label="Scan instead"
          className="flex size-10 items-center justify-center rounded-xl bg-forest-tint text-forest"
        >
          <ScanLine className="size-[18px]" aria-hidden />
        </Link>
      </div>

      <div role="group" aria-label="Dosage form" className="flex flex-wrap gap-2">
        {DOSAGE_FILTERS.map((option) => (
          <Chip key={option.id} active={filter === option.id} onClick={() => setFilter(option.id)}>
            {option.label}
          </Chip>
        ))}
      </div>

      <div role="status" className="mx-1 mt-0.5 text-xs font-bold text-ink-muted">
        {results.length} {results.length === 1 ? "result" : "results"}
      </div>

      <div className="flex flex-col gap-2.5">
        {results.length === 0 ? (
          <Surface className="px-4 py-5 text-sm text-ink-muted">
            No medicine in the demo register matches that. Check the number or try a name.
          </Surface>
        ) : null}
        {results.map((record) => {
          const inactive = isInactiveStatus(record.approvalStatus);
          return (
            <Surface key={record.registrationNumber} className="rounded-[18px]">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
                  <div className="flex size-[42px] shrink-0 items-center justify-center rounded-[13px] bg-surface-sunken font-heading text-[15px] font-bold text-forest">
                    {initials(record.productName)}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="truncate text-[15px] font-bold">{record.productName}</div>
                    <div className="truncate text-xs text-ink-muted">
                      <span className="font-mono font-semibold">{record.registrationNumber}</span> ·{" "}
                      {record.dosageForm ?? "Unknown form"}
                    </div>
                  </div>
                  <Pill tone={inactive ? "amber" : "forest"}>{record.approvalStatus ?? "Unknown"}</Pill>
                </summary>
                <dl className="grid grid-cols-2 gap-3 border-t border-surface-sunken px-3.5 py-3.5 text-sm">
                  {[
                    ["Active ingredient", record.activeIngredients.join(", ") || "—"],
                    ["Strength", record.strength ?? "—"],
                    ["Manufacturer", record.manufacturer ?? "—"],
                    ["Approved", record.approvalDate ? formatDate(record.approvalDate) : "—"],
                  ].map(([term, value]) => (
                    <div key={term} className="flex flex-col gap-0.5">
                      <dt className="text-xs font-bold text-ink-faint">{term}</dt>
                      <dd className="font-bold">{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </Surface>
          );
        })}
      </div>
    </Page>
  );
}
