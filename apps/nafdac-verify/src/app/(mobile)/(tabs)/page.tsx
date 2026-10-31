import Link from "next/link";
import { ArrowRight, Bell, ChevronRight, Flag, Keyboard, ScanLine, Search } from "lucide-react";
import { RecentChecks } from "@/components/app/recent-checks";
import { ManualEntryLink } from "@/components/app/review-form";
import { ScanButton } from "@/components/app/scanner-sheet";
import { IconTile, Page, Surface, Wordmark } from "@/components/app/ui";

export default function Home() {
  return (
    <Page>
      <header className="flex items-center justify-between">
        <Wordmark subtitle="Check before you take it" />
        <Link
          href="/alerts"
          aria-label="NAFDAC alerts"
          className="flex size-10 items-center justify-center rounded-field border border-line bg-surface text-ink"
        >
          <Bell className="size-[18px]" aria-hidden />
        </Link>
      </header>

      <section className="flex flex-col gap-5 rounded-sheet bg-blue p-6 text-white">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">Is your medicine safe to take?</h1>
          <p className="text-sm leading-relaxed text-white/80">
            Photograph the pack. We read it and check NAFDAC&apos;s register and every recall and safety alert.
          </p>
        </div>
        <ScanButton className="flex h-12 items-center justify-center gap-2 rounded-field bg-white text-[15px] font-semibold text-blue-strong">
          <ScanLine className="size-[18px]" aria-hidden />
          Scan a pack
          <ArrowRight className="size-4" aria-hidden />
        </ScanButton>
      </section>

      <Link
        href="/alerts"
        className="flex h-12 items-center gap-3 rounded-field border border-line bg-surface px-4 text-sm text-ink-faint"
      >
        <Search className="size-[18px]" aria-hidden />
        Search alerts by product or batch number
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <ManualEntryLink>
          <Surface className="flex h-full flex-col gap-3 p-4">
            <IconTile icon={Keyboard} tone="neutral" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">Type the details</span>
              <span className="text-xs text-ink-muted">No camera needed</span>
            </div>
          </Surface>
        </ManualEntryLink>
        <Link href="/report" transitionTypes={["nav-forward"]}>
          <Surface className="flex h-full flex-col gap-3 p-4">
            <IconTile icon={Flag} tone="neutral" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">Report a product</span>
              <span className="text-xs text-ink-muted">Sent to our reviewers</span>
            </div>
          </Surface>
        </Link>
      </div>

      <Link href="/alerts">
        <Surface className="flex items-center gap-3 p-4">
          <IconTile icon={Bell} tone="accent" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold">NAFDAC safety alerts</span>
            <span className="text-xs text-ink-muted">Recalls and falsified product warnings</span>
          </div>
          <ChevronRight className="size-5 text-ink-faint" aria-hidden />
        </Surface>
      </Link>

      <RecentChecks />
    </Page>
  );
}
