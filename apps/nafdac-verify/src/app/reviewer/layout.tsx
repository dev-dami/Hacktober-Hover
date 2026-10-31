import Link from "next/link";
import { Wordmark } from "@/components/app/ui";

export default function ReviewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5">
          <Link href="/reviewer">
            <Wordmark size={32} subtitle="Reviewer console" />
          </Link>
          <Link href="/" className="text-sm font-semibold text-ink-muted hover:text-ink">
            Open the app
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">{children}</main>
    </div>
  );
}
