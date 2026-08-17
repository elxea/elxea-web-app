"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import type { ConsentChoice } from "@/lib/consent";
import {
  setConsentChoice,
  useConsentBannerForcedOpen,
  useConsentChoice,
} from "@/lib/consent-store";

/**
 * Custom property published while this banner occupies the bottom of the
 * viewport. Other bottom-fixed UI adds it to its own offset so it clears the
 * banner instead of hiding behind it. Consumers default it to `0px`.
 */
const BOTTOM_OBSTRUCTION_VAR = "--bottom-obstruction";

/**
 * Cookie consent banner.
 *
 * Visible only when the visitor has no valid choice on record, or when they
 * re-opened it from the footer to change their mind. The choice itself lives in
 * `lib/consent.ts`; the shared store in `lib/consent-store.ts` is what lets the
 * GTM container react to a click here without a page reload.
 */
export function CookieConsent() {
  const t = useTranslations("cookie");
  const choice = useConsentChoice();
  const forcedOpen = useConsentBannerForcedOpen();
  const bannerRef = useRef<HTMLDivElement>(null);

  // "unknown" is the server / pre-hydration state. Rendering the banner then
  // would flash it on every page load for visitors who already chose.
  const visible = choice !== "unknown" && (choice === null || forcedOpen);

  // Publish the banner's real height rather than a guessed constant: it wraps
  // to a taller two-row layout below `sm`, so a hard-coded value would be wrong
  // on exactly the viewport where space is tightest. Without this the chat
  // launcher (z-40) is completely buried by this banner (z-50) on a first
  // visit — and on desktop the launcher is now the only way into chat.
  useEffect(() => {
    const root = document.documentElement;
    const el = bannerRef.current;
    if (!visible || !el) {
      root.style.removeProperty(BOTTOM_OBSTRUCTION_VAR);
      return;
    }

    const publish = () =>
      root.style.setProperty(BOTTOM_OBSTRUCTION_VAR, `${el.offsetHeight}px`);
    publish();

    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(BOTTOM_OBSTRUCTION_VAR);
    };
  }, [visible]);

  if (!visible) return null;

  const choose = (next: ConsentChoice) => {
    const previous = choice;
    setConsentChoice(next);
    // Withdrawing consent has to take effect now, not on the next navigation:
    // once the GTM container has booted, unmounting the <Script> cannot unload
    // it. A reload is the only reliable way to get back to an untagged page.
    if (previous === "all" && next === "essential") {
      window.location.reload();
    }
  };

  return (
    <div
      ref={bannerRef}
      data-slot="cookie-consent"
      className="fixed bottom-0 left-0 right-0 z-50 w-full max-w-full border-t border-border bg-background"
    >
      {/* 統合 (2026-08-17): 同意の中身は main 版 (lib/consent + consent-store 経由で
          GTM に伝わる版) を採り、内側の幅取りだけ c1-ds のデザインシステムの
          `.page-container` に載せ替えた。ハードコードの `max-w-7xl px-6` を残すと
          ページ余白トークン (--page-margin) から外れる。 */}
      <div className="page-container py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p className="text-sm text-muted-foreground flex-1 min-w-0 break-words">
          {t("message")}{" "}
          <Link
            href="/legal/privacy"
            className="underline hover:text-foreground transition-colors"
          >
            {t("learnMore")}
          </Link>
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={() => choose("essential")}>
            {t("decline")}
          </Button>
          <Button size="sm" onClick={() => choose("all")}>
            {t("accept")}
          </Button>
        </div>
      </div>
    </div>
  );
}
