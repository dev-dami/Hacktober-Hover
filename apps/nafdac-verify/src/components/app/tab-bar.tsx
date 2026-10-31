"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Clock, House, ScanLine, Search, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Column positions in the 5-slot bar; the centre slot (2) is the scan button.
const TABS: { href: string; label: string; icon: LucideIcon; slot: number }[] = [
  { href: "/", label: "Home", icon: House, slot: 0 },
  { href: "/lookup", label: "Lookup", icon: Search, slot: 1 },
  { href: "/alerts", label: "Alerts", icon: Bell, slot: 3 },
  { href: "/history", label: "History", icon: Clock, slot: 4 },
];

function activeSlot(pathname: string): number {
  return TABS.find((tab) => tab.href === pathname)?.slot ?? -1;
}

export function TabBar() {
  const pathname = usePathname();
  const current = activeSlot(pathname);

  return (
    <nav
      aria-label="Main"
      className="fixed bottom-4 left-1/2 z-10 h-[68px] w-[calc(min(100%,430px)-24px)] -translate-x-1/2 rounded-[26px] border border-line bg-white shadow-float"
    >
      <div className="relative grid h-full grid-cols-5 items-center px-1.5">
        <span
          aria-hidden
          data-visible={current >= 0}
          style={{ "--slot": Math.max(current, 0) } as React.CSSProperties}
          className="glass-pill pointer-events-none absolute inset-y-[7px] left-1.5 w-[calc((100%-0.75rem)/5)]"
        />

        {TABS.slice(0, 2).map((tab) => (
          <TabLink key={tab.href} tab={tab} active={tab.slot === current} />
        ))}

        <Link
          href="/scan"
          transitionTypes={["nav-forward"]}
          aria-label="Scan packaging"
          className="glossy-scan relative z-10 -mt-[30px] flex size-[60px] items-center justify-center justify-self-center rounded-full text-white"
        >
          <ScanLine className="size-6 drop-shadow-[0_1px_1px_rgba(20,70,5,0.5)]" aria-hidden />
        </Link>

        {TABS.slice(2).map((tab) => (
          <TabLink key={tab.href} tab={tab} active={tab.slot === current} />
        ))}
      </div>
    </nav>
  );
}

function TabLink({ tab, active }: { tab: (typeof TABS)[number]; active: boolean }) {
  const Icon = tab.icon;
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative z-10 flex flex-col items-center gap-0.5 py-2 text-[11px] font-bold text-ink-faint transition-colors duration-300",
        active && "font-extrabold text-forest",
      )}
    >
      <Icon key={String(active)} className={cn("size-[22px]", active && "tab-pop")} aria-hidden />
      {tab.label}
    </Link>
  );
}
