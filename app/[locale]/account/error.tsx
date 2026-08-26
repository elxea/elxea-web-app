"use client";

import { useTranslations, useLocale } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/log";

/**
 * Account-specific error boundary.
 *
 * Handles network-level fetch failures (e.g. "Load failed TypeError")
 * that occur when the Shopify Customer Account API is unreachable or
 * the user's session is in an invalid state. Instead of showing a
 * generic error, we offer a retry and a link back to login.
 *
 * 記録は `lib/log` を通す (憲章 Wave 3 / R1)。ここは会員資格・定期便が見える
 * 区画なので、「顧客に契約が見えていない」を数えられる形で残す必要がある。
 * 通信断かどうかの判定結果もそのまま記録に載せる — 上流障害とアプリ側の欠陥を
 * 後から切り分ける手がかりになる。
 */
export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  const tAccount = useTranslations("account");
  const locale = useLocale();

  const isLoadFailed =
    error.message?.includes("Load failed") ||
    error.message?.includes("fetch failed") ||
    error.message?.includes("network");

  useEffect(() => {
    logger.error("ui.boundary.account", error, {
      digest: error.digest,
      isLoadFailed,
    });
  }, [error, isLoadFailed]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <h1 className="mb-4">{t("errorTitle")}</h1>
      <p className="text-muted-foreground text-sm mb-10 max-w-md">
        {isLoadFailed
          ? tAccount("networkError")
          : t("errorDescription")}
      </p>
      <div className="flex gap-4">
        <Button variant="outline" onClick={reset}>
          {t("retry")}
        </Button>
        <Button variant="outline" asChild>
          <a href={`/${locale}/login`}>{t("login")}</a>
        </Button>
      </div>
    </div>
  );
}
