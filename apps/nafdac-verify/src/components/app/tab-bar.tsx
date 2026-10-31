"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Clock, Flag, House, ScanLine, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScanButton } from "./scanner-sheet";

// `href: null` opens the scanner sheet instead of navigating.
const TABS: { href: string | null; label: string; icon: LucideIcon; forward?: boolean }[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: null, label: "Scan a medicine", icon: ScanLine },
  { href: "/history", label: "History", icon: Clock },
  { href: "/report", label: "Report a product", icon: Flag, forward: true },
];

// The bar has 8px side padding; the bump is 104px wide and centres on the active slot.
const bumpLeft = (index: number) => `calc(8px + (100% - 16px) * ${(index + 0.5) / TABS.length} - 52px)`;
const SPRING = "duration-500 ease-[cubic-bezier(0.34,1.25,0.5,1)] motion-reduce:transition-none";

export function TabBar() {
  const pathname = usePathname();
  const active = TABS.findIndex((tab) => tab.href === pathname);

  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 left-1/2 z-10 w-full max-w-[440px] -translate-x-1/2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {/* Bar and bump share one drop shadow, so they read as a single shape. */}
      <div className="relative h-16 [filter:drop-shadow(0_1px_2px_rgb(16_24_40/0.06))_drop-shadow(0_8px_20px_rgb(16_24_40/0.10))]">
        {active >= 0 ? (
          <svg
            aria-hidden
            viewBox="0 0 104 28"
            className={cn("absolute -top-[27px] h-7 w-[104px] fill-surface transition-[left]", SPRING)}
            style={{ left: bumpLeft(active) }}
          >
            <path d="M0 28 C 22 28 26 1 52 1 C 78 1 82 28 104 28 Z" />
          </svg>
        ) : null}
        <div className="absolute inset-0 rounded-sheet bg-surface" />

        <ul className="relative grid h-full px-2" style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}>
          {TABS.map((tab, index) => {
            const Icon = tab.icon;
            const current = index === active;
            const style = cn(
              "flex size-12 items-center justify-center rounded-full text-ink-faint transition-all hover:text-ink",
              SPRING,
              current && "-translate-y-5 bg-pink text-white shadow-[0_6px_14px_-4px_rgb(224_79_138/0.55)] hover:text-white",
            );
            if (tab.href === null) {
              return (
                <li key={tab.label} className="flex items-center justify-center">
                  <ScanButton label={tab.label} className={style}>
                    <Icon className="size-[22px]" aria-hidden />
                  </ScanButton>
                </li>
              );
            }
            return (
              <li key={tab.href} className="flex items-center justify-center">
                <Link
                  href={tab.href}
                  aria-label={tab.label}
                  aria-current={current ? "page" : undefined}
                  transitionTypes={tab.forward ? ["nav-forward"] : undefined}
                  className={style}
                >
                  <Icon className="size-[22px]" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
