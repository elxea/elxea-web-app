import * as Sentry from "@sentry/nextjs";

import { assertEnvValid, env } from "./lib/config";

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
 *
 * ## `NEXT_RUNTIME` だけは生読みする (レジストリに入れてはいけない)
 *
 * 下の 2 つの分岐だけ `process.env.NEXT_RUNTIME` を直接読んでいる。これは
 * 例外の抜け道ではなく、**この値が設定ではないから**。`NEXT_RUNTIME` は人が
 * ダッシュボードに入れる値ではなく、バンドラが「いま edge 向けにビルドして
 * いるのか nodejs 向けなのか」をビルド時に文字列リテラルとして埋め込む
 * コンパイル対象の識別子で、埋め込まれた結果 `if ("edge" === "nodejs")` に
 * なった分岐は丸ごと消える (dead code elimination)。消えることに意味がある:
 * nodejs 側の分岐は `sentry.server.config` と `fake-firestore` →
 * `firebase-admin` を引き込んでおり、これらは node:http / node:fs / node:net
 * などに依存する。
 *
 * `env("NEXT_RUNTIME")` は関数呼び出しなのでビルド時に畳めない。畳めないと
 * 分岐が消えず、Node 専用モジュールが **Edge Function の bundle に入る**。
 * 実害 (2026-08-27): Wave 1 (#164) を main にマージしたところ、CI の全 required
 * check は緑のまま Vercel のデプロイだけが落ちた:
 *
 *     Error: The Edge Function "_middleware" is referencing unsupported modules:
 *       - __vc__ns__/0/index.js: node:http, node:https, node:zlib, node:stream,
 *         node:net, node:fs, node:path
 *
 * `next build` は成功するので required check では捕まらない (Vercel が出力を
 * 配る段で初めて落ちる)。本番は fail-closed で直前のデプロイを配り続けたが、
 * main は「マージできるがデプロイできない」状態になった。
 *
 * したがって `NEXT_RUNTIME` は `lib/config/spec.ts` から**外してある**。
 * レジストリに残しておくと `env("NEXT_RUNTIME")` がまた書けてしまい、同じ
 * 壊れ方が静かに戻る。宣言を消すことが再流入止め (憲章 R8)。
 */
export async function register() {
  assertEnvValid();

  // eslint-disable-next-line no-restricted-syntax -- ビルド時に畳まれる必要がある。理由は上の doc comment を参照
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    await installE2eFirestoreIfRequested();
  }
  // eslint-disable-next-line no-restricted-syntax -- 同上
  if (process.env.NEXT_RUNTIME === "edge") {
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
 *   1. `NODE_ENV !== "production"` … ここでも見る（`setInjectedFirestoreForE2E` 側でも throw する）
 *   2. `E2E_FIRESTORE_STUB === "1"` … 既定では何もしない
 *   3. 偽物の import は **この分岐の中の動的 import** … 通常起動では読み込まれない
 *
 * 理由と安全性の議論は `lib/firebase/admin.ts` の差し込み口のコメントに置いてある
 * （二重に書かない）。
 *
 * ## `NODE_ENV` の判定を先に、しかも生読みで置く理由
 *
 * この 2 つの early return は順序と読み方に意味がある。`next build` は必ず
 * `NODE_ENV=production` で走るので、`process.env.NODE_ENV === "production"` と
 * **リテラルで**書いてあればバンドラがこれを `if (true) return;` に畳み、
 * それ以降が到達不能になって下の動的 import ごと落ちる。落ちることが目的:
 * `fake-firestore` は `firebase-admin` を引き込み、`firebase-admin` は gaxios /
 * gcp-metadata / node-fetch 経由で node:http・node:net・node:fs などに依存する。
 * これらが Edge Function の bundle に入ると Vercel のデプロイが
 * unsupported modules で落ちる（2026-08-27 実害。詳細は `register()` の
 * doc comment）。
 *
 * `isProduction()` は関数呼び出しなので畳めず、到達不能にならない。よってここは
 * `env()` 経由にできない。逆に `E2E_FIRESTORE_STUB` は畳む必要が無いので
 * レジストリ経由のままでよく、production ビルドでは上の return より後ろにある
 * ぶん丸ごと消える。
 */
async function installE2eFirestoreIfRequested(): Promise<void> {
  // eslint-disable-next-line no-restricted-syntax -- ビルド時に畳んで下の動的 import を消すためリテラルで読む。理由は上の doc comment
  if (process.env.NODE_ENV === "production") return;
  if (env("E2E_FIRESTORE_STUB") !== "1") return;

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
