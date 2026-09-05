/**
 * 3本のGET (`self` / `field` / `words`) が依存する唯一の抽象と、その解決。
 *
 * API route はこのファイルの `ProfileSource` インターフェースだけに依存し、
 * 値の出どころ (Live / Synthetic) を知らない。Figma が表現を変えても契約と
 * 場の計算は不変であるのと同じ理由で、データの出どころも描画から独立させる。
 *
 * ## 生成データ混入防止 (5層防御・層1 + 層2)
 *
 * - **層1 到達不能化**: `lib/profile/synthetic/**` を import できるのはこの
 *   ファイルだけ (`eslint.config.mjs` の `no-restricted-imports` で強制。
 *   CI 側の裏取りは `scripts/check-synthetic-import-boundary.mjs`)。
 * - **層2 実行時 fail-closed (改訂 2026-09-05)**: 既定では `VERCEL_ENV ===
 *   "production"` かつ `PROFILE_DATA_SOURCE === "synthetic"` の組み合わせは
 *   ここで例外を投げる。ただし「初期はダミーデータで見せる」
 *   (Setaka決定・反論なし。Decision Log
 *   https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac) により、
 *   明示フラグ `PROFILE_DEMO_MODE=true` があるときだけ本番でも synthetic を
 *   許す。フラグが無ければ従来どおり設定ミスでは通り抜けられない。
 *   デモモードでも `source: "synthetic"` の開示・`X-Profile-Source` ヘッダー・
 *   `Cache-Control: private, no-store` は変わらず適用される (層3/層5は
 *   `SyntheticSource` 自身が `source:"synthetic"` を名乗り、
 *   `lib/profile/cache-policy.ts` が `synthetic` を常に private,no-store に
 *   倒すため、デモモード有無で分岐を増やす必要が無い)。
 *
 * 層3 (キャッシュ隔離) は API route 側、層4 (テスト) は
 * `__tests__/profile-anonymity.test.ts`、層5 (開示) は `source` フィールドと
 * `X-Profile-Source` ヘッダーが担う。
 */

import "server-only";

import { env } from "@/lib/config";
import type {
  ProfileFieldParams,
  ProfileFieldResponse,
  ProfileSelfParams,
  ProfileSelfResponse,
  ProfileSourceKind,
  ProfileWordsParams,
  ProfileWordsResponse,
} from "@/lib/profile/contract";

export interface ProfileSource {
  readonly kind: ProfileSourceKind;
  getSelf(params: ProfileSelfParams): Promise<ProfileSelfResponse>;
  getField(params: ProfileFieldParams): Promise<ProfileFieldResponse>;
  getWords(params: ProfileWordsParams): Promise<ProfileWordsResponse>;
}

/** `PROFILE_DATA_SOURCE=synthetic` が本番へ配達されようとしたときに投げる。 */
export class ProfileSourceConfigError extends Error {}

/**
 * 現在の設定に応じて `ProfileSource` を解決する。
 *
 * `synthetic` の実装は動的 import で読み込む — 静的 import にすると
 * `lib/profile/live/index.ts` を経由しないすべての呼び出し経路で
 * `lib/profile/synthetic/**` がモジュールグラフに常時含まれてしまい、層1
 * (到達不能化) の意図 (本番ビルドの server bundle からの排除) と噛み合わない。
 */
export async function getProfileSource(): Promise<ProfileSource> {
  const mode = env("PROFILE_DATA_SOURCE");

  if (mode === "synthetic") {
    const isProductionWithoutDemoMode = env("VERCEL_ENV") === "production" && !env("PROFILE_DEMO_MODE");
    if (isProductionWithoutDemoMode) {
      throw new ProfileSourceConfigError(
        "PROFILE_DATA_SOURCE=synthetic は本番では使用できません " +
          "(生成データ混入防止・fail-closed。PROFILE_DEMO_MODE=true が無い限り通さない。" +
          "lib/profile/source.ts#getProfileSource)。",
      );
    }
    const mod = await import("@/lib/profile/synthetic");
    return new mod.SyntheticSource();
  }

  const mod = await import("@/lib/profile/live");
  return new mod.LiveSource();
}
