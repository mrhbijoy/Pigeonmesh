import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PigeonMesh Cloud Bridge — crisis mesh coordination",
  description:
    "A public, Vercel-deployed mesh peer that bridges internet-connected routers to a global coordination dashboard. SOS, missing-person reports and safe check-ins from every connected mesh, live.",
  keywords: [
    "PigeonMesh",
    "mesh network",
    "crisis tech",
    "disaster response",
    "OpenWrt",
    "ESP32",
    "delay-tolerant networking",
  ],
  authors: [{ name: "PigeonMesh" }],
  openGraph: {
    title: "PigeonMesh Cloud Bridge",
    description: "Communication that survives the shutdown.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PigeonMesh Cloud Bridge",
    description: "Communication that survives the shutdown.",
  },
};

export const viewport = {
  themeColor: "#0b1220",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="min-h-screen bg-[#0b1220] text-slate-200 antialiased">{children}</body>
    </html>
  );
}
