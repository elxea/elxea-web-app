"use client";

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

  // "unknown" is the server / pre-hydration state. Rendering the banner then
  // would flash it on every page load for visitors who already chose.
  if (choice === "unknown") return null;
  if (choice !== null && !forcedOpen) return null;

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
    <div className="fixed bottom-0 left-0 right-0 z-50 w-full max-w-full border-t border-border bg-background">
      <div className="w-full max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
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
