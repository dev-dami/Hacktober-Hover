import Link from "next/link";
import { ShieldCheck } from "lucide-react";

const LINKS = [
  { href: "/", label: "Scan" },
  { href: "/alerts", label: "Alerts" },
  { href: "/report", label: "Report" },
];

export function SiteHeader() {
  return (
    <header className="border-b bg-background/95 sticky top-0 z-10 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-emerald-600" aria-hidden />
          SafeMeds NG
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="rounded-md px-3 py-1.5 hover:bg-muted">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t py-6 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 sm:flex-row sm:justify-between">
        <p>
          Alerts and registrations come from public NAFDAC sources. SafeMeds NG cannot prove a product is genuine or
          fake. Only NAFDAC can.
        </p>
        <Link href="/review" className="shrink-0 hover:underline">
          Reviewer access
        </Link>
      </div>
    </footer>
  );
}
