import * as Sentry from "@sentry/nextjs";

/**
 * 定期便操作の失敗を「顧客に見せる形」と「調査できる形」に分ける単一の出口。
 *
 * なぜ必要か: 定期便の操作はすべて Server Action ＝ 公開 HTTP エンドポイント
 * なので、返り値の `error` は**そのままブラウザに届く**。下流の生メッセージを
 * 詰めて返すと、顧客 ID や外部 API の内部状態が画面に出る。実測例:
 *
 *   {"success":false,"error":"Customer API 429 throttled for customer 8877"}
 *
 * Shopify の userErrors / GraphQL errors もストア側の事情 (在庫・プラン構成・
 * 内部 ID) を含みうるため、顧客に転送してよい前提が置けない。
 *
 * よって失敗の詳細は**サーバー側にだけ**残し、顧客には返さない:
 *
 * - サーバーログ: どの操作がどう失敗したかを 1 行で残す (調査の入口)
 * - Sentry: 操作名をタグに付けて送る (集計・アラートの対象にできる)
 *
 * 呼び出し側は詳細を載せず `{ success: false }` を返す。画面側は
 * `messages/{ja,en}.json` の `actionError` / `frequencyChangeError` へ
 * フォールバックするので、顧客には既存のローカライズ済み文言が出る
 * (サーバーが英語の内部文を作って表示に混ぜることはない)。
 *
 * 例外は**意図して機械可読にしたコード**だけ (`STALE_BILLING_CYCLE_VIEW` /
 * `Invalid subscription contract ID` / 所有者照合の一般化文言)。これらは内部情報を
 * 含まず、画面が案内文へ差し替えるために必要なので従来どおり返す。
 */
export function reportSubscriptionFailure(
  operation: string,
  detail: unknown,
  extra?: Record<string, unknown>
): void {
  console.error(
    `[subscription:${operation}] 失敗したため顧客には一般化した文言を返しました。`,
    detail,
    extra ?? {}
  );

  Sentry.captureException(
    detail instanceof Error ? detail : new Error(`subscription ${operation} failed`),
    {
      tags: { feature: "subscription-actions", operation },
      extra: {
        ...extra,
        // Error でない失敗 (userErrors 配列・HTTP status 等) も本文を残す
        detail: detail instanceof Error ? undefined : detail,
        customerFacing:
          "generic failure message from messages/*.json (no internal detail)",
      },
    }
  );
}
