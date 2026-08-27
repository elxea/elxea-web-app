import * as Sentry from "@sentry/nextjs";

import { assertEnvValid, env, isProduction } from "./lib/config";

/**
 * `register()` はリクエストを受け付ける前に 1 回だけ走る、というのが Next の契約。
 * 設定の検証をここに置いているのはそのため — 壊れた設定のまま 1 リクエストでも
 * 処理してしまえば、そのぶんだけ「静かに間違った出力」が世に出る。
 *
 * ## なぜ「起動させない」なのか (憲章 R4)
 *
 * この判断は実害から来ている。`NEXT_PUBLIC_SITE_URL` に末尾改行が入ったとき、
 * サイトは正常に見えたまま sitemap の `<loc>` 172 件が全部不正な URL になった。
 * LINE の Channel Secret に末尾改行が入ったときも、サイトは正常に見えたまま
 * 連携だけが 400 で落ち続けた。どちらも「動いているように見える壊れ方」で、
 * 気づくまでに時間がかかっている。起動時に落とせば、壊れた設定は必ず
 * デプロイの時点で目に見える。
 *
 * 落とすのは Vercel 上 (production と preview) だけで、手元と CI では警告に
 * とどまる。判定は `lib/config` の `shouldFailFast()` にある。preview を対象に
 * 含めているのは意図的で、preview で落ちないなら「落ちること」を確かめる場所が
 * 本番しか無くなるため。
 *
 * ## 実測: 壊れた設定は「起動しない」より前に「ビルドが通らない」
 *
 * `register()` は `next build` の page data 収集でも走るので、実際には
 * デプロイが作られる前に落ちる。実測 (2026-08-27):
 *
 *     VERCEL_ENV=preview NEXT_PUBLIC_SITE_URL='not a url' next build
 *     → Error [EnvConfigError]: NEXT_PUBLIC_SITE_URL: must be an absolute http(s) URL
 *     → exit 1（"Failed to collect page data"）
 *
 * これは意図した以上に良い性質で、**壊れた設定のデプロイは存在しない**
 * ことを意味する。本番は直前の正常なデプロイを配信し続ける (fail-closed)。
 * CI の `build` ジョブも required check なので、同じ検査が PR の段階で効く。
 *
 * エラー文に値は出ない (上の実測でも変数名と制約だけ)。設定エラーはしばしば
 * 資格情報についてのエラーなので、received を出すと設定ミスがそのまま漏洩になる。
 */
export async function register() {
  assertEnvValid();

  if (env("NEXT_RUNTIME") === "nodejs") {
    await import("./sentry.server.config");
    await installE2eFirestoreIfRequested();
  }
  if (env("NEXT_RUNTIME") === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * E2E（Ring 2）のときだけ、プロセス内の偽 Firestore を差し込む。
 *
 * `register()` はリクエストを受け付ける前に 1 回だけ走ることが Next の契約なので、
 * 最初の route handler が `getAdminFirestore()` を呼ぶ時点では必ず差し込みが済んでいる。
 *
 * 3 重に閉じている:
 *   1. `E2E_FIRESTORE_STUB === "1"` … 既定では何もしない
 *   2. `NODE_ENV !== "production"` … ここでも見る（`setInjectedFirestoreForE2E` 側でも throw する）
 *   3. 偽物の import は **この分岐の中の動的 import** … 通常起動では読み込まれない
 *
 * 理由と安全性の議論は `lib/firebase/admin.ts` の差し込み口のコメントに置いてある
 * （二重に書かない）。
 */
async function installE2eFirestoreIfRequested(): Promise<void> {
  if (env("E2E_FIRESTORE_STUB") !== "1") return;
  if (isProduction()) return;

  const [{ createFakeFirestore }, { setInjectedFirestoreForE2E }] = await Promise.all([
    import("./__tests__/helpers/fake-firestore"),
    import("./lib/firebase/admin"),
  ]);

  setInjectedFirestoreForE2E(createFakeFirestore().db);
  console.warn(
    "[instrumentation] E2E_FIRESTORE_STUB=1 — in-memory Firestore installed. " +
      "No real Firestore is reachable from this process.",
  );
}

export const onRequestError = Sentry.captureRequestError;
