"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/log";

/**
 * 一般ページの受け皿。記録は `lib/log` を通す (憲章 Wave 3 / R1)。
 * どの受け皿で落ちたかをタグに残さないと、「エラー画面を見た人が何人いるか」を
 * 区画ごとに数えられない。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    logger.error("ui.boundary.locale", error, { digest: error.digest });
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <h1 className="mb-4">{t("errorTitle")}</h1>
      <p className="text-muted-foreground text-sm mb-10 max-w-md">
        {t("errorDescription")}
      </p>
      <Button variant="outline" onClick={reset}>
        {t("retry")}
      </Button>
    </div>
  );
}
