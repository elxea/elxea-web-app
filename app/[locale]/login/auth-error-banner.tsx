"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * P2-fix: Displays an error banner when `?error=<code>` is present in the URL.
 * Error codes are set by /api/line-callback when authentication fails.
 */

const ERROR_KEY_MAP: Record<string, string> = {
  LineAuthFailed: "errorLineAuthFailed",
  StateMismatch: "errorStateMismatch",
  TokenFailed: "errorTokenFailed",
  ProfileFailed: "errorProfileFailed",
  NotConfigured: "errorNotConfigured",
  MissingParams: "errorMissingParams",
  Unexpected: "errorUnexpected",
};

export function AuthErrorBanner() {
  const searchParams = useSearchParams();
  const t = useTranslations("login");
  const errorCode = searchParams.get("error");

  if (!errorCode) return null;

  const messageKey = ERROR_KEY_MAP[errorCode] ?? "errorUnexpected";

  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {t(messageKey)}
    </div>
  );
}
