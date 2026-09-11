"use client";

import { useTranslations } from "next-intl";

import { openConsentBanner } from "@/lib/consent-store";

/**
 * Footer entry point for changing a cookie choice.
 *
 * Without this, "必要なもののみ" was a one-way door: the banner never came back,
 * so a visitor could never opt in later. Opening the banner does not clear the
 * stored choice — it only shows the panel again.
 */
export function CookieSettingsButton() {
  const t = useTranslations("cookie");

  return (
    <button
      type="button"
      onClick={openConsentBanner}
      className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {t("settings")}
    </button>
  );
}
