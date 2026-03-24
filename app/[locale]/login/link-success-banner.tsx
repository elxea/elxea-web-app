"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * Displays a success banner when `?linked=true` is present in the URL.
 * This appears after a successful LINE Login + identity link.
 */
export function LinkSuccessBanner() {
  const searchParams = useSearchParams();
  const t = useTranslations("login");
  const isLinked = searchParams.get("linked") === "true";

  if (!isLinked) return null;

  return (
    <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-center text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
      {t("linkedSuccess")}
    </div>
  );
}
