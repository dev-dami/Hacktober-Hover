import Link from "next/link";
import { ArrowUpRight, Bell, Hash, Image as ImageIcon, ScanLine, Search } from "lucide-react";
import { RecentChecks } from "@/components/app/recent-checks";
import { Logo, Page, Surface } from "@/components/app/ui";

const STEPS = [
  { n: "1", label: "Scan" },
  { n: "2", label: "Confirm" },
  { n: "3", label: "Compare" },
] as const;

export default function Home() {
  return (
    <Page className="gap-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo size={46} />
          <div className="flex flex-col">
            <span className="font-heading text-lg leading-tight font-bold tracking-tight">NAFDAC Verify</span>
            <span className="text-[13px] text-ink-muted">Check before you take it</span>
          </div>
        </div>
        <Link
          href="/alerts"
          aria-label="Alerts"
          className="relative flex size-12 items-center justify-center rounded-full border border-line bg-white text-forest shadow-card"
        >
          <Bell className="size-5" aria-hidden />
          <span aria-hidden className="absolute top-3 right-3.5 size-2 rounded-full bg-scan ring-2 ring-white" />
        </Link>
      </header>

      <Link
        href="/lookup"
        className="flex h-14 items-center gap-3 rounded-full border border-line bg-white p-2 pr-5 shadow-card"
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-forest text-white">
          <Search className="size-[18px]" aria-hidden />
        </span>
        <span className="flex-1 text-sm text-ink-muted">Search medicine or reg. number</span>
        <Hash className="size-[18px] text-ink-faint" aria-hidden />
      </Link>

      <div className="flex flex-col gap-1.5 px-1">
        <h1 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.025em]">
          Is your medicine what the pack says it is?
        </h1>
      </div>

      <section className="bg-hero relative overflow-hidden rounded-hero p-5 text-white shadow-hero">
        <div
          aria-hidden
          className="absolute top-5 right-5 flex h-[104px] w-[84px] rotate-[8deg] flex-col gap-1.5 rounded-2xl bg-white p-3 shadow-[0_16px_30px_-10px_rgba(0,0,0,0.45)]"
        >
          <div className="h-2 w-[70%] rounded bg-forest" />
          <div className="h-[5px] w-[90%] rounded bg-line" />
          <div className="h-[5px] w-[60%] rounded bg-line" />
          <div className="mt-auto h-4 w-full rounded border-[1.5px] border-dashed border-forest" />
        </div>
        <div className="relative flex max-w-[210px] flex-col gap-2">
          <div className="font-heading text-[24px] leading-tight font-semibold tracking-tight">Scan the packaging</div>
          <p className="text-sm leading-normal text-white/90">
            We read the label and compare it with NAFDAC&apos;s medicine register.
          </p>
        </div>

        <ol className="relative mt-5 grid grid-cols-3 gap-2" aria-label="How it works">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="flex flex-col items-center gap-0.5 rounded-2xl border border-white/25 bg-white/15 py-2.5 backdrop-blur-sm"
            >
              <span className="text-base leading-none font-extrabold">{step.n}</span>
              <span className="text-xs font-semibold text-white/90">{step.label}</span>
            </li>
          ))}
        </ol>

        <Link
          href="/scan"
          transitionTypes={["nav-forward"]}
          className="relative mt-4 flex h-[54px] items-center justify-center gap-2.5 rounded-full bg-white text-[15px] font-extrabold text-forest-deep shadow-[0_10px_20px_-10px_rgba(0,0,0,0.5)]"
        >
          <ScanLine className="size-5" aria-hidden />
          Start scan
          <ArrowUpRight className="size-4" aria-hidden />
        </Link>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/lookup">
          <Surface className="flex h-full flex-col gap-3 p-4">
            <div className="flex size-11 items-center justify-center rounded-full bg-forest-tint text-forest">
              <Hash className="size-5" aria-hidden />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="text-[15px] font-bold">Enter reg. number</div>
              <div className="text-[13px] text-ink-muted">No camera needed</div>
            </div>
          </Surface>
        </Link>
        <Link href="/scan" transitionTypes={["nav-forward"]}>
          <Surface className="flex h-full flex-col gap-3 p-4">
            <div className="flex size-11 items-center justify-center rounded-full bg-amber-tint text-amber">
              <ImageIcon className="size-5" aria-hidden />
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="text-[15px] font-bold">Try a demo pack</div>
              <div className="text-[13px] text-ink-muted">Sample labels</div>
            </div>
          </Surface>
        </Link>
      </div>

      <RecentChecks />
    </Page>
  );
}
