/**
 * `Cache-Control` の出し分け (源で分ける・層3「キャッシュ隔離」)。
 *
 * `source:"live"` かつ本番のときだけ `public, s-maxage`。それ以外
 * (`source:"synthetic"`、または非本番環境) は常に `private, no-store`。
 * `Vary` は使わない — `source` はサーバー側の決定値であって、リクエストヘッダの
 * 差異ではないため CDN 側では機能しない (Spec §「実データ契約」B)。
 *
 * 3本の route (self/field/words) が同じ関数を呼ぶことで、キャッシュ隔離の判定を
 * 1か所に固定する。純関数なので `__tests__/profile-anonymity.test.ts` で
 * 直接固定できる。
 */

import type { ProfileSourceKind } from "@/lib/profile/contract";

export function resolveProfileCacheControl(
  sourceKind: ProfileSourceKind,
  vercelEnv: string | undefined,
): string {
  const isLiveProduction = sourceKind === "live" && vercelEnv === "production";
  return isLiveProduction
    ? "public, s-maxage=3600, stale-while-revalidate=86400"
    : "private, no-store";
}
