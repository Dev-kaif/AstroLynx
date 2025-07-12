import type React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { StarfieldBackground } from "@/components/starfield-background";
import { Navigation } from "@/components/navigation";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AstroLynx - Geo-Aware Satellite AI Assistant",
  description:
    "AI-powered chatbot for satellite data navigation and ISRO mission analysis",
  generator: "v0.dev",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <head>
        <link rel="shortcut icon" href="/favicon.png" type="image/x-icon" />
      </head>
      <html lang="en">
        <body className={inter.className}>
          <StarfieldBackground />
          {/* <Navigation/> */}
          {children}
        </body>
      </html>
    </>
  );
}
