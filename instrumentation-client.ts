import * as Sentry from "@sentry/nextjs";

import { env } from "@/lib/config";

/**
 * 憲章 R4 への移行 (Wave 1 QA 指摘 / 2026-08-27)。
 * DSN は `lib/config/spec.ts` の宣言を通して読む。未設定の判定を各ファイルで
 * 決め直さないためで、trim も spec 側で済む (末尾改行つきの URL が本番を
 * 壊した前例がある)。
 */
const dsn = env("NEXT_PUBLIC_SENTRY_DSN");

Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  enabled: Boolean(dsn),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
