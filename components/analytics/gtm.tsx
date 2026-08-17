"use client";

import Script from "next/script";

import { isAnalyticsAllowed } from "@/lib/consent";
import { useConsentChoice } from "@/lib/consent-store";
import { getGtmId } from "@/lib/env";

/**
 * The Google Tag Manager snippet itself, with no consent logic.
 *
 * Renders nothing when `NEXT_PUBLIC_GTM_ID` is unset, so preview/local builds
 * without the variable stay untagged.
 *
 * `getGtmId()` reads the id through the trimming env reader because the id is
 * interpolated into an inline script and into a googletagmanager.com URL: a
 * trailing newline from `vercel env add` would break both.
 */
export function GoogleTagManagerScript() {
  const gtmId = getGtmId();
  if (!gtmId) return null;

  return (
    <>
      <Script
        id="gtm-script"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${gtmId}');
          `,
        }}
      />
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
          height="0"
          width="0"
          style={{ display: "none", visibility: "hidden" }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  );
}

/**
 * Consent-gated Google Tag Manager container. This is what the root layout
 * mounts.
 *
 * The container loads only for an explicit "同意する". Before a choice is made,
 * and for "必要なもののみ", nothing GTM-related reaches the document — no inline
 * bootstrap, no `gtm.js` request, no `ns.html` iframe.
 *
 * History (two separate defects):
 *  - 2026-03..2026-08: this component existed but nothing mounted it, so the
 *    site shipped with no measurement tag for ~4 months
 *    (deliverables/ga4-searchconsole-repair.md §1 (1)). It is mounted in the
 *    ROOT layout — the single node every route tree passes through — so a new
 *    route tree cannot silently ship untagged.
 *  - 2026-08 (#52 .. this change): once mounted, it loaded unconditionally. The
 *    cookie banner wrote the visitor's choice to localStorage and no code ever
 *    read it back for analytics, so declining did nothing. Measured in a real
 *    browser before this fix: `gtm.js` loaded both before any choice and after
 *    "必要なもののみ".
 *
 * Rendering is client-side on purpose. Reading the choice from a cookie in the
 * root layout would work too, but it would make every route dynamic and lose
 * static generation site-wide.
 */
export function GoogleTagManager() {
  const choice = useConsentChoice();
  if (choice === "unknown") return null;
  if (!isAnalyticsAllowed(choice)) return null;
  return <GoogleTagManagerScript />;
}
