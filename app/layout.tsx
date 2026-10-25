import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

// Same pairing as Higgsfield: Space Grotesk for uppercase headings, Inter for everything else.
const title = Space_Grotesk({ variable: "--font-title", subsets: ["latin"] });
const body = Inter({ variable: "--font-body", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "mithraa.SHI", template: "%s | mithraa.SHI" },
  description: "The studio where agents make films with you: from a voice note to release, with your team signing every gate.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${title.variable} ${body.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
