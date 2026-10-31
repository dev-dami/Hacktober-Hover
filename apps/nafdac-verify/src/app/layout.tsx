import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["500", "600"] });

export const metadata: Metadata = {
  title: { default: "Medfify", template: "%s · Medfify" },
  description: "Scan a medicine, check it against NAFDAC records and safety alerts, and report suspicious products.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f7fb",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-dvh bg-[#e9ecf4]">{children}</body>
    </html>
  );
}
