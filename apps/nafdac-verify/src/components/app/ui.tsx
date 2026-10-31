import { ViewTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "forest" | "coral" | "amber" | "slate" | "neutral";

export const TONES: Record<Tone, string> = {
  forest: "bg-verified-tint text-verified",
  coral: "bg-coral-tint text-coral",
  amber: "bg-amber-tint text-amber",
  slate: "bg-slate-tint text-slate",
  neutral: "bg-surface-sunken text-ink-muted",
};

export const TONE_TEXT: Record<Tone, string> = {
  forest: "text-verified",
  coral: "text-coral",
  amber: "text-amber",
  slate: "text-slate",
  neutral: "text-ink-muted",
};

export function Pill({
  tone,
  mono,
  className,
  children,
}: {
  tone: Tone;
  mono?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-extrabold",
        mono && "font-mono font-semibold",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

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
    <ViewTransition enter={DIRECTIONAL} exit={DIRECTIONAL} default="none">
      <main className={cn("flex flex-col gap-5 px-5 pt-14 pb-10", className)}>{children}</main>
    </ViewTransition>
  );
}

export function Surface({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-line bg-white shadow-card", className)} {...props} />;
}

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <Image
      src="/logo.png"
      alt="NAFDAC Verify"
      width={size}
      height={size}
      priority
      className="rounded-xl"
    />
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      transitionTypes={["nav-back"]}
      aria-label={label}
      className="flex size-11 items-center justify-center rounded-[14px] border border-line bg-card text-ink shadow-card"
    >
      <ChevronLeft className="size-[22px]" aria-hidden />
    </Link>
  );
}

export function Notice({ children, tone = "slate" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <div className={cn("flex gap-2.5 rounded-[18px] px-3.5 py-3 text-[13px] leading-snug", TONES[tone])}>
      {children}
    </div>
  );
}
