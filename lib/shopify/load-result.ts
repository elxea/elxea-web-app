import * as Sentry from "@sentry/nextjs";

/**
 * 「引けなかった」と「引いた結果が空だった」を型で分ける（設計憲章 R1 / R4）。
 *
 * ## 何を直しているか
 *
 * Shopify を引く関数がずっと `T | null` / `T[]` を返していた。呼び出し側から見ると
 * `null` は 2 つの全く違う事実に同時に使われていた:
 *
 *   1. **確定的に未ログイン** — cookie が無い。答えは出ている。
 *   2. **判定できなかった** — Shopify が落ちている / token 交換が失敗した。
 *      答えは出ていない。
 *
 * 区別が無いので、Shopify 側の障害はそのまま「ログアウト」として描画されていた。
 * 決済・会員資格に関わる画面で、これは顧客に**嘘をつく**ことになる —
 * 定期便契約は生きているのに「ログインしてください」と表示し、しかも
 * サーバー側には `console.error` が 1 行残るだけで、**アラートは一切鳴らない**。
 * `console.error` は Vercel のログに落ちるだけで、集計もアラートも付いていない。
 *
 * ## 型
 *
 * - `{ ok: true, data: T }` … 引けた。`data` が `null` / `[]` なら**それが答え**。
 * - `{ ok: false, reason }` … 引けなかった。**`data` は存在しない**ので、
 *   呼び出し側は「空だった」と取り違えようがない。
 *
 * `ok: false` に `data` を持たせないのが要点である。省略可能な `data?: T` にすると
 * `result.data ?? []` で今までどおり握り潰せてしまい、型が何も守らなくなる。
 */
export type LoadFailureReason =
  /** 外部 API に問い合わせたが答えが得られなかった（通信断・5xx・GraphQL エラー）。 */
  | "upstream-unavailable"
  /** 手元の資格情報が壊れていて問い合わせに進めなかった（復号失敗など）。 */
  | "credentials-unreadable";

export type LoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: LoadFailureReason };

export function loaded<T>(data: T): LoadResult<T> {
  return { ok: true, data };
}

export function loadFailed<T>(reason: LoadFailureReason): LoadResult<T> {
  return { ok: false, reason };
}

/**
 * 「引けなかった」を**調査できる形**で残す単一の出口。
 *
 * `lib/shopify/subscription-failure.ts` の `reportSubscriptionFailure` と同じ考え方で、
 * こちらはセッション・顧客の読み出し系を受け持つ。分けてあるのはタグが違うから
 * （`feature: session-load` で絞れば「顧客が黙ってログアウトさせられている」だけを
 * 数えられる）。
 *
 * ⚠ 顧客に見せる文言はここでは作らない。画面側が `messages/{ja,en}.json` の
 *   ローカライズ済み文言へ落とす。外部 API の生メッセージには顧客 ID や
 *   ストアの内部状態が入りうるため、ブラウザには渡さない。
 */
export function reportLoadFailure(
  operation: string,
  detail: unknown,
  extra?: Record<string, unknown>,
): void {
  console.error(
    `[session-load:${operation}] 引けなかったため「判定不能」として扱いました。`,
    detail,
    extra ?? {},
  );

  Sentry.captureException(
    detail instanceof Error ? detail : new Error(`session load ${operation} failed`),
    {
      tags: { feature: "session-load", operation },
      extra: {
        ...extra,
        detail: detail instanceof Error ? undefined : detail,
      },
    },
  );
}
