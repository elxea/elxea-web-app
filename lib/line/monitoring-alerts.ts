/**
 * 運営 (Setaka) 宛 LINE 監視通知の文面と送出。
 *
 * 位置づけ: `sendLineNotify` は「1 人へ push する」だけの送信層で、何を・いつ
 * 送るかは持たない。このモジュールが「どの異常を、どういう文面で運営に上げるか」
 * を一箇所で決める。route 側は状況に対応する関数を 1 行呼ぶだけにする。
 *
 * 守る不変条件:
 *   1. **例外を外に出さない**。監視通知の失敗が課金や webhook の本処理を壊しては
 *      いけない。かつ黙って落とさない (握りつぶさず console.error に残す)。
 *      本処理を壊さない唯一の関門が下の `push()` の try/catch。
 *   2. **顧客の個人情報を載せない**。載せるのは件数と、Shopify 上で引ける識別子
 *      (契約 ID・注文番号) だけ。エラー文言はメールアドレスを伏せてから載せる
 *      (Shopify / 決済側の文言に紛れ込むことがある)。
 *   3. **1 事象 1 通**。契約ごとに送らず run 単位で集約する (失敗が並んだ日に
 *      通知が溢れて読まれなくなるのを防ぐ)。
 *
 * 文面は機能的マイクロコピー: 何が起きたか / 数と識別子 / 次にどこを見るか。
 */
import { sendLineNotify, type LineNotifyPayload } from "./notify";

/** 本文に列挙する識別子の上限。超えた分は「他 N 件」に畳む。 */
const MAX_LISTED_IDS = 5;

/** エラー文言の最大長。スタックや長い API 応答をそのまま流さない。 */
const MAX_DETAIL_CHARS = 200;

/**
 * Shopify の GID を末尾の数値 ID だけにする。
 * `gid://shopify/SubscriptionContract/7001` -> `7001`
 * 形が違えば元の文字列を返す (推測して壊さない)。
 */
export function shortId(gid: string): string {
  const tail = gid.split("/").pop();
  return tail ? tail : gid;
}

/**
 * 通知に載せる前にエラー文言を無害化する。
 * - メールアドレスらしき箇所を `<email>` に置換 (顧客 PII の混入経路)
 * - 改行・連続空白を 1 スペースに畳む (LINE 上で読める形にする)
 * - `MAX_DETAIL_CHARS` で切る
 */
export function sanitizeDetail(raw: string): string {
  const withoutEmail = raw.replace(
    /[\w.!#$%&'*+/=?^_`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g,
    "<email>",
  );
  const oneLine = withoutEmail.replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) return "(詳細なし)";
  return oneLine.length > MAX_DETAIL_CHARS
    ? `${oneLine.slice(0, MAX_DETAIL_CHARS)}...`
    : oneLine;
}

/** 識別子の列挙。0 件なら "-"、上限超過は「他 N 件」。 */
function formatIdList(ids: string[]): string {
  if (ids.length === 0) return "-";
  const shown = ids.slice(0, MAX_LISTED_IDS).map(shortId);
  const rest = ids.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} 他 ${rest} 件` : shown.join(", ");
}

/**
 * 送出の唯一の出口。ここで例外を止める。
 * `sendLineNotify` 自身も内部で失敗を飲むが、それに依存しない
 * (送信層の実装が変わっても本処理が落ちない、という保証をこちら側で持つ)。
 */
async function push(payload: LineNotifyPayload): Promise<void> {
  try {
    await sendLineNotify(payload);
  } catch (error) {
    console.error("[LINE Notify] 監視通知の送信に失敗しました:", error);
  }
}

export type BillingRunFailureAlert = {
  /** この run の課金対象契約数 */
  due: number;
  /** 初回試行が失敗した件数 (action=failed) */
  failed: number;
  /** 再試行が失敗した件数 (action=retry_failed) */
  retryFailed: number;
  /** 処理中の例外で結果が取れなかった件数 (action=error) */
  errors: number;
  /** 上記に該当した契約の GID */
  contractIds: string[];
};

/**
 * 課金 cron の run 内で失敗が出た (failed / retry_failed / error)。
 * run 単位で 1 通。契約ごとには送らない。
 */
export async function notifyBillingRunFailures(
  alert: BillingRunFailureAlert,
): Promise<void> {
  await push({
    level: "warning",
    subject: "定期便の課金に失敗があります",
    body: [
      `対象 ${alert.due} 件 / 初回失敗 ${alert.failed} 件 / 再試行失敗 ${alert.retryFailed} 件 / 処理エラー ${alert.errors} 件`,
      `契約: ${formatIdList(alert.contractIds)}`,
      "確認: Shopify Admin > 定期購入",
    ].join("\n"),
  });
}

/**
 * 課金 cron が最後まで走れずに落ちた (契約一覧の取得失敗など)。
 * 「今日は課金が行われていない」ことを伝えるのが要点。
 */
export async function notifyBillingCronFatal({
  message,
}: {
  message: string;
}): Promise<void> {
  await push({
    level: "error",
    subject: "定期便の課金cronが異常終了しました",
    body: [
      `原因: ${sanitizeDetail(message)}`,
      "この実行では課金処理が完了していません。復旧後の再実行が必要です。",
    ].join("\n"),
  });
}

/**
 * 督促の上限に達して契約を停止した (PAUSE 遷移)。
 * 顧客への最終案内は課金 cron 側で送っているので、運営側は「止まった事実」を受ける。
 */
export async function notifySubscriptionPaused({
  contractId,
  failureCount,
}: {
  contractId: string;
  failureCount: number;
}): Promise<void> {
  await push({
    level: "error",
    subject: "定期便契約を停止しました (課金リトライ上限)",
    body: [
      `契約: ${shortId(contractId)}`,
      `課金失敗 ${failureCount} 回で自動停止。顧客への最終案内は送信済み。`,
      "確認: Shopify Admin > 定期購入",
    ].join("\n"),
  });
}

/**
 * webhook 処理が例外で落ちた。
 * Shopify は非 2xx を再送するので、1 通目は「様子見」で足りる。連続したら調査。
 */
export async function notifyWebhookException({
  webhook,
  reference,
  message,
}: {
  /** Shopify の topic (例: `orders/create`) */
  webhook: string;
  /** Shopify 上で引ける識別子。顧客名・メールは入れない */
  reference?: string;
  message: string;
}): Promise<void> {
  await push({
    level: "error",
    subject: "Shopify webhook の処理に失敗しました",
    body: [
      `webhook: ${webhook}`,
      ...(reference ? [`対象: ${reference}`] : []),
      `原因: ${sanitizeDetail(message)}`,
      "Shopify が再送します。連続する場合は要調査。",
    ].join("\n"),
  });
}
