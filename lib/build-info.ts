/**
 * 「いま本番で何が配信されているか」を答えるための、公開してよい状態だけの集合。
 *
 * ## なぜ必要か
 *
 * 本番はサイトパスワードで守られているため、パスワードを持たない側 (エージェント・
 * 監視・当番でない人) は中身を一切確認できない。「200 が返るか」だけの監視では、
 * **古いデプロイが生きていても緑**になる。必要なのは「応答があるか」ではなく
 * 「**何が**配信されているか」。
 *
 * ## なぜ既存の監視では足りないのか
 *
 * `scripts/ops/check-prod-main-sync.mjs` は同じ「どのコミットが本番か」を見ているが、
 * 出どころが違う:
 *
 * | | 何を根拠にするか | 秘密 |
 * |---|---|---|
 * | check-prod-main-sync | Vercel の**デプロイ記録** (`meta.githubCommitSha`) | `VERCEL_TOKEN` が要る |
 * | ここ | **動いているアプリ自身の応答** | 不要 |
 *
 * 「Vercel がデプロイしたと記録している」と「いまリクエストに答えているコードが
 * それだ」は別の事実である。本番の前段には Cloudflare が居るため (実測 2026-09-11:
 * `server: cloudflare` / `cf-cache-status`)、デプロイ記録だけでは配信面の実体を
 * 保証できない。
 *
 * ## 値の出どころ
 *
 * `VERCEL_GIT_COMMIT_SHA` / `VERCEL_ENV` を `env()` 経由で読む。どちらも
 * `lib/config/spec.ts` に宣言済みで、Vercel が実行時に注入する。
 * `app/[locale]/layout.tsx` が `x-elxea-commit` ヘッダーに使っているのと**同じ値**で、
 * 新しい仕組みも新しい環境変数も増やしていない (そのヘッダーは gate の 307 では
 * layout に到達しないため公開面からは見えない。ここはその穴を塞ぐ)。
 *
 * ## 置いてよい値
 *
 * **秘密を入れないこと。** ここの値は認証なしで公開される。返すのは状態だけで、
 * ページの内容・データ・環境変数は含めない。キー集合は
 * `__tests__/api-version.test.ts` で固定してあり、増やすとテストが落ちる。
 */

import { env } from "@/lib/config";

/** 配信中のコミット SHA。取れなければ "unknown" (呼び出し側は fail-closed 扱い)。 */
export function buildSha(): string {
  return env("VERCEL_GIT_COMMIT_SHA") ?? "unknown";
}

/** 短縮 SHA (7 桁)。"unknown" のときはそのまま "unknown"。 */
export function buildShaShort(): string {
  const sha = buildSha();
  return sha === "unknown" ? "unknown" : sha.slice(0, 7);
}

/** production / preview / development。 */
export function buildEnv(): string {
  return env("VERCEL_ENV") ?? "unknown";
}

/**
 * 公開してよい**状態のみ**の集合。
 *
 * 値は毎回読み直す (モジュール定数にしない)。`lib/config` が意図的に無キャッシュな
 * のと同じ理由で、焼き込んだ定数は「同じ事実の第二の正本」になるため。
 */
export function getPublicBuildInfo() {
  return {
    sha: buildSha(),
    shaShort: buildShaShort(),
    env: buildEnv(),
  } as const;
}

/** 配信ビルドを示すヘッダー名。`app/[locale]/layout.tsx` の `x-elxea-commit` と対。 */
export const BUILD_HEADER = "x-elxea-build";
