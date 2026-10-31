"use client";

import { useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { formatDate } from "@/lib/format";
import { SAMPLE_ALERTS, filterAlerts, type AlertFilter } from "@/lib/alerts";
import { cn } from "@/lib/utils";
import { Chip } from "./lookup-search";
import { Notice, Page, Pill, Surface } from "./ui";

const FILTERS: { id: AlertFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "falsified", label: "Falsified" },
  { id: "recalled", label: "Recalled" },
];

export function AlertsFeed() {
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const alerts = filterAlerts(SAMPLE_ALERTS, filter);

  return (
    <Page className="gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">NAFDAC alerts</h1>
        <p className="text-sm text-ink-muted">Public notices on falsified and recalled medicines.</p>
      </div>

      <Notice>
        <Info className="mt-px size-[18px] shrink-0" aria-hidden />
        <span>These are sample alerts for the demo. The live feed will come from NAFDAC public notices.</span>
      </Notice>

      <div role="group" aria-label="Alert type" className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <Chip key={option.id} active={filter === option.id} onClick={() => setFilter(option.id)}>
            {option.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {alerts.map((alert) => {
          const expanded = open === alert.id;
          return (
            <Surface key={alert.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between">
                <Pill tone={alert.type === "falsified" ? "coral" : "amber"}>
                  {alert.type === "falsified" ? "Falsified" : "Recall"}
                </Pill>
                <span className="text-xs font-semibold text-ink-muted">{formatDate(alert.date)}</span>
              </div>
              <h2 className="text-lg font-semibold tracking-tight">{alert.productName}</h2>
              <div className="font-mono text-xs font-semibold text-ink-muted">{alert.registrationNumber}</div>
              <p className="text-sm leading-snug">{alert.issue}</p>
              {expanded ? (
                <p id={`notice-${alert.id}`} className="rounded-xl bg-surface-sunken px-3 py-2.5 text-[13px] leading-snug">
                  {alert.notice}
                </p>
              ) : null}
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`notice-${alert.id}`}
                onClick={() => setOpen(expanded ? null : alert.id)}
                className="flex min-h-11 items-center gap-1 self-start text-sm font-extrabold text-forest"
              >
                {expanded ? "Hide notice" : "Read notice"}
                <ChevronRight className={cn("size-4 transition-transform", expanded && "rotate-90")} aria-hidden />
              </button>
            </Surface>
          );
        })}
      </div>
    </Page>
  );
}
