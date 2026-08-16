import Script from "next/script";

import { getGtmId } from "@/lib/env";

/**
 * Google Tag Manager container.
 *
 * Renders nothing when `NEXT_PUBLIC_GTM_ID` is unset, so preview/local builds
 * without the variable stay untagged.
 *
 * History: this component was added 2026-03-10 but never mounted anywhere, so
 * the Next.js site shipped with no measurement tag at all from the Shopify
 * migration until 2026-08 — GA4 recorded zero sessions for ~4 months while the
 * container id sat correctly configured in Vercel.
 * See deliverables/ga4-searchconsole-repair.md §1 (1).
 *
 * `getGtmId()` reads the id through the trimming env reader because the id is
 * interpolated into an inline script and into a googletagmanager.com URL: a
 * trailing newline from `vercel env add` would break both.
 */
export function GoogleTagManager() {
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
