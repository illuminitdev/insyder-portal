import type { Metadata } from "next";
import { Geist, Geist_Mono, Schibsted_Grotesk } from "next/font/google";
import { RouteShell } from "@/components/layout/RouteShell";
import "./globals.css";

/* Insyder type: Geist for body text, Schibsted Grotesk for headings and the wordmark */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-schibsted",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Insyder",
  description: "Account intelligence for revenue teams: research, qualification and outreach enablement",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} ${schibsted.variable} font-sans antialiased`}>
        <RouteShell>{children}</RouteShell>
      </body>
    </html>
  );
}
