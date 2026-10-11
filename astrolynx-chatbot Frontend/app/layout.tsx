import type React from "react";
import type { Metadata } from "next";
import "./globals.css";
import { StarfieldBackground } from "@/components/starfield-background";

export const metadata: Metadata = {
  title: "AstroLynx - Geo-Aware Satellite AI Assistant",
  description:
    "AI-powered chatbot for satellite data navigation and ISRO mission analysis",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <StarfieldBackground />
        {/* <Navigation /> */}
        {children}
      </body>
    </html>
  );
}
