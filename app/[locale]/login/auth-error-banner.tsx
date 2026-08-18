"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthCardBanner } from "@/components/auth/auth-card";

/**
 * P2-fix: Displays an error banner when `?error=<code>` is present in the URL.
 * Error codes are set by /api/line-callback when authentication fails.
 *
 * 見た目は Figma【R2: 確定版】AuthErrorBanner 5344:3 (状態枠 6706:14468) に従う =
 * カード内・上部・h44 / destructive の細罫 + 同色テキスト。
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
    <AuthCardBanner tone="error" role="alert">
      {t(messageKey)}
    </AuthCardBanner>
  );
}
