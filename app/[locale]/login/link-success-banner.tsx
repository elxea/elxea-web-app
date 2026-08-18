"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthCardBanner } from "@/components/auth/auth-card";

/**
 * Displays a success banner when `?linked=true` is present in the URL.
 * This appears after a successful LINE Login + identity link.
 *
 * 見た目は Figma【R2: 確定版】LinkSuccessBanner 5344:5 (状態枠 6706:14468) に従う =
 * カード内・上部・h44 / success の細罫。
 */
export function LinkSuccessBanner() {
  const searchParams = useSearchParams();
  const t = useTranslations("login");
  const isLinked = searchParams.get("linked") === "true";

  if (!isLinked) return null;

  return <AuthCardBanner tone="success">{t("linkedSuccess")}</AuthCardBanner>;
}
