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
 *   ファイルだけ (`eslint.config.mjs` の `no-restricted-imports` で強制)。
 * - **層2 実行時 fail-closed**: `VERCEL_ENV === "production"` かつ
 *   `PROFILE_DATA_SOURCE === "synthetic"` の組み合わせはここで例外を投げる。
 *   設定ミスでは通り抜けられない。
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
    if (env("VERCEL_ENV") === "production") {
      throw new ProfileSourceConfigError(
        "PROFILE_DATA_SOURCE=synthetic は本番では使用できません " +
          "(生成データ混入防止・fail-closed。lib/profile/source.ts#getProfileSource)。",
      );
    }
    const mod = await import("@/lib/profile/synthetic");
    return new mod.SyntheticSource();
  }

  const mod = await import("@/lib/profile/live");
  return new mod.LiveSource();
}
