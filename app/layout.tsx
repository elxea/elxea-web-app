import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "elxea",
  description: "elxea - Single-Origin Japanese Tea",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
