import type { Metadata } from "next";
import "./globals.css";
import { GoogleTagManager } from "@/components/analytics/gtm";

export const metadata: Metadata = {
  title: "elxea",
  description: "elxea - Single-Origin Japanese Tea",
};

/**
 * Root layout.
 *
 * This layout deliberately does NOT render `<html>` / `<body>`: each route tree
 * below it owns its own document shell (`app/[locale]/layout.tsx`,
 * `app/dev/layout.tsx`, `app/(studio)/layout.tsx`) because they need different
 * `lang`, `<head>` content and body classes.
 *
 * The GTM container is mounted here — the one node every route tree passes
 * through — so measurement can never again be missing from a page just because
 * a new route tree forgot to add it. `next/script` with `afterInteractive`
 * injects into the document itself, so it does not depend on being nested
 * inside `<body>` in the React tree.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {children}
      <GoogleTagManager />
    </>
  );
}
