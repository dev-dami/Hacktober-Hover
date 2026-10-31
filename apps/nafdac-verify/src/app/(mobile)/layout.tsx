import { ScannerSheet } from "@/components/app/scanner-sheet";

// The citizen app is phone-first: on wide screens it renders as a centred phone-width column.
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto min-h-dvh w-full max-w-[440px] bg-canvas sm:shadow-raised">
      {children}
      <ScannerSheet />
    </div>
  );
}
