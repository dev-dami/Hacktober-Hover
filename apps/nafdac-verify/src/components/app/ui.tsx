import { ViewTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ShieldCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** `safe`, `caution` and `danger` are status only. `info` is brand blue, `accent` is brand pink. */
export type Tone = "safe" | "caution" | "danger" | "info" | "accent" | "neutral";

export const TONES: Record<Tone, string> = {
  safe: "bg-safe-tint text-safe",
  caution: "bg-caution-tint text-caution",
  danger: "bg-danger-tint text-danger",
  info: "bg-blue-tint text-blue-strong",
  accent: "bg-pink-tint text-pink-strong",
  neutral: "bg-sunken text-ink-muted",
};

export const TONE_TEXT: Record<Tone, string> = {
  safe: "text-safe",
  caution: "text-caution",
  danger: "text-danger",
  info: "text-blue-strong",
  accent: "text-pink-strong",
  neutral: "text-ink-muted",
};

/** Full-width call to action used at the bottom of flows. */
export const PRIMARY_ACTION =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-field bg-blue px-5 text-[15px] font-semibold text-white shadow-action transition-colors hover:bg-blue-strong disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[18px]";
export const SECONDARY_ACTION =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-field border border-line bg-surface px-5 text-[15px] font-semibold text-ink transition-colors hover:bg-sunken disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[18px]";

const DIRECTIONAL = {
  "nav-forward": "nav-forward",
  "nav-back": "nav-back",
  default: "none",
} as const;

export function FlowTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter={DIRECTIONAL} exit={DIRECTIONAL} default="none">
      {children}
    </ViewTransition>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <FlowTransition>
      <main className={cn("flex flex-col gap-6 px-5 pt-6 pb-10", className)}>{children}</main>
    </FlowTransition>
  );
}

/** Page title block. `back` adds a back button; `action` sits on the right. */
export function PageHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4">
      {back || action ? (
        <div className="flex items-center justify-between">
          {back ? <BackLink href={back.href} label={back.label} /> : <span />}
          {action}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm leading-relaxed text-ink-muted">{subtitle}</p> : null}
      </div>
    </header>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Surface({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-line bg-surface shadow-card", className)} {...props} />;
}

export function Pill({ tone, mono, className, children }: { tone: Tone; mono?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
        mono && "font-mono font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function IconTile({ icon: Icon, tone, className }: { icon: LucideIcon; tone: Tone; className?: string }) {
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-field", TONES[tone], className)}>
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

export function Notice({ children, tone = "neutral", icon: Icon }: { children: React.ReactNode; tone?: Tone; icon?: LucideIcon }) {
  return (
    <div className={cn("flex gap-3 rounded-card px-4 py-3 text-sm leading-relaxed", TONES[tone])}>
      {Icon ? <Icon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-lg bg-blue text-white"
    >
      <ShieldCheck style={{ width: size * 0.56, height: size * 0.56 }} strokeWidth={2} />
    </span>
  );
}

export function Wordmark({ size = 36, subtitle }: { size?: number; subtitle?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} />
      <span className="flex flex-col leading-tight">
        <span className="font-heading text-lg font-bold tracking-tight">Medfify</span>
        {subtitle ? <span className="text-xs text-ink-muted">{subtitle}</span> : null}
      </span>
    </span>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      transitionTypes={["nav-back"]}
      aria-label={label}
      className="flex size-10 items-center justify-center rounded-field border border-line bg-surface text-ink shadow-card"
    >
      <ChevronLeft className="size-5" aria-hidden />
    </Link>
  );
}

/** Three-step progress for Scan → Confirm → Result. */
export function StepBar({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-muted">Step {step} of 3</span>
      <div className="grid grid-cols-3 gap-1.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={cn("h-1 rounded-full", n <= step ? "bg-blue" : "bg-line")} />
        ))}
      </div>
    </div>
  );
}

/** Toggle chip for filters. */
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-lg border px-3.5 text-sm font-medium transition-colors",
        active ? "border-blue bg-blue text-white" : "border-line bg-surface text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Small label line above a card title: a coloured lead word, then muted details. */
export function Eyebrow({ tone = "neutral", lead, rest = [] }: { tone?: Tone; lead?: string; rest?: string[] }) {
  return (
    <p className="text-xs font-medium text-ink-muted">
      {lead ? <span className={cn("font-semibold", TONE_TEXT[tone])}>{lead}</span> : null}
      {rest.map((item, index) => (
        <span key={item}>
          {lead || index > 0 ? " · " : ""}
          {item}
        </span>
      ))}
    </p>
  );
}
