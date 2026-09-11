"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthCardBanner } from "@/components/auth/auth-card";

import { resolveAuthErrorMessageKey } from "./auth-error-keys";

/**
 * P2-fix: Displays an error banner when `?error=<code>` is present in the URL.
 * Error codes are set by `/api/line-callback` and `/api/auth/callback` when
 * authentication fails.
 *
 * 見た目は Figma【R2: 確定版】AuthErrorBanner 5344:3 (状態枠 6706:14468) に従う =
 * カード内・上部・h44 / destructive の細罫 + 同色テキスト。
 *
 * コード → 文言の対応表は `./auth-error-keys` にある (テストから直接読めるように
 * 分離してある。理由はそのファイルの docstring)。
 */
export function AuthErrorBanner() {
  const searchParams = useSearchParams();
  const t = useTranslations("login");
  const errorCode = searchParams.get("error");

  if (!errorCode) return null;

  return (
    <AuthCardBanner tone="error" role="alert">
      {t(resolveAuthErrorMessageKey(errorCode))}
    </AuthCardBanner>
  );
}
