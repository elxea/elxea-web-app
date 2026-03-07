"use client";

import { useTranslations } from "next-intl";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <h1 className="text-2xl mb-4">{t("errorTitle")}</h1>
      <p className="text-muted text-[14px] mb-10 max-w-md">
        {t("errorDescription")}
      </p>
      <button
        onClick={reset}
        className="inline-block border border-charcoal px-8 py-3 text-[13px] font-medium hover:bg-charcoal hover:text-cream transition-colors"
      >
        {t("retry")}
      </button>
    </div>
  );
}
