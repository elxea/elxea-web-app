/**
 * 定期便リマインダーの「送った」台帳 (二重送信ガード)。
 *
 * ## なぜ必要か (2026-08-11 の失敗系監査 Medium-2)
 *
 * リマインダー cron は「請求日が 3 日後の契約」を日付一致だけで拾う。冪等キーが
 * どこにも無いので、cron が同じ日に二重発火する (Vercel の再実行・手動実行・
 * リトライ) と**同じ顧客に同じメールが 2 通届く**。課金 cron 側の督促は試行番号で
 * 1 通に閉じているが、リマインダーには対応する仕組みが無かった。
 *
 * ## 設計: 送る前に取る (claim-before-send)
 *
 * 「契約 x 対象日」で 1 通だけを許す予約を Firestore の `create()` (既存ドキュメントが
 * あれば失敗する) で取り、取れたときだけ送る。取れなければ送らない。
 *
 * **送信前に取る**のは、顧客に二重で届くことのほうが 1 通落ちることより重いから。
 * リマインダーは金銭も契約状態も動かさない案内であり、送れなかった場合は監視
 * (Sentry) に出て運営が手で送れる。逆に二重送信は取り消せない。
 *
 * 予約は送信結果 (`sent` / `failed`) で更新するが、**失敗しても予約は消さない**。
 * Resend がエラーを返したのか、届いた後に接続が切れたのかを区別できないため、
 * 自動での再送はしない (運営が Resend のダッシュボードで確認して判断する)。
 *
 * ## 運用要件
 *
 * `_reminderLogs` に TTL ポリシー (フィールド `ttl`) を設定する。
 *   gcloud firestore fields ttls update ttl \
 *     --collection-group=_reminderLogs --enable-ttl
 */
import { getAdminFirestore } from "@/lib/firebase/admin";

export const REMINDER_LOG_COLLECTION = "_reminderLogs";

/** 台帳の保持期間 (日)。対象日の重複判定に要るのは同日だけなので短くてよい。 */
export const REMINDER_LOG_TTL_DAYS = 30;

const SUBSCRIPTION_CONTRACT_GID = /^gid:\/\/shopify\/SubscriptionContract\/(\d+)$/;

export type ReminderClaim =
  /** 予約を取れた。呼び出し側はこのときだけ送ってよい。 */
  | { claimed: true; docId: string }
  /** 既に送信済み (同じ契約・同じ対象日)。送ってはいけない。 */
  | { claimed: false; reason: "duplicate" }
  /** 予約そのものが取れなかった。安全側で送らない。 */
  | { claimed: false; reason: "claim-failed"; detail: string };

/**
 * 台帳の doc ID。契約 GID の数値サフィックス + 対象日 (YYYY-MM-DD)。
 * 形が違えば null (呼び出し側は送らない側に倒す)。
 */
export function reminderLogDocId(
  contractId: string,
  reminderDate: string
): string | null {
  const match = SUBSCRIPTION_CONTRACT_GID.exec(contractId);
  if (!match) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reminderDate)) return null;
  return `${match[1]}_${reminderDate}`;
}

/**
 * 送信の予約を取る。取れたときだけ送ってよい。
 *
 * `create()` は同じ ID の doc が既にあると失敗するので、cron が同時に二重発火しても
 * どちらか 1 本しか通らない (アプリ側のロックではなく Firestore の原子性に任せる)。
 */
export async function claimReminderSend(
  contractId: string,
  reminderDate: string
): Promise<ReminderClaim> {
  const docId = reminderLogDocId(contractId, reminderDate);
  if (!docId) {
    return {
      claimed: false,
      reason: "claim-failed",
      detail: `unusable claim key (contract=${contractId}, date=${reminderDate})`,
    };
  }

  try {
    const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
    await getAdminFirestore()
      .collection(REMINDER_LOG_COLLECTION)
      .doc(docId)
      .create({
        contractId,
        reminderDate,
        status: "claimed",
        claimedAt: FieldValue.serverTimestamp(),
        ttl: Timestamp.fromDate(
          new Date(Date.now() + REMINDER_LOG_TTL_DAYS * 24 * 60 * 60 * 1000)
        ),
      });
    return { claimed: true, docId };
  } catch (error) {
    if (isAlreadyExists(error)) {
      return { claimed: false, reason: "duplicate" };
    }
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[Subscription Reminder] 送信予約に失敗しました (${docId}):`,
      error
    );
    return { claimed: false, reason: "claim-failed", detail };
  }
}

/**
 * 予約に送信結果を書き戻す (運営が後から追える形にするため)。
 * 失敗しても呼び出し側の処理は続ける — 記録の失敗でメールの成否は変わらない。
 */
export async function recordReminderOutcome(
  docId: string,
  outcome: { sent: boolean; error?: string }
): Promise<void> {
  try {
    const { FieldValue } = await import("firebase-admin/firestore");
    await getAdminFirestore()
      .collection(REMINDER_LOG_COLLECTION)
      .doc(docId)
      .set(
        {
          status: outcome.sent ? "sent" : "failed",
          ...(outcome.error ? { error: outcome.error } : {}),
          completedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  } catch (error) {
    console.error(
      `[Subscription Reminder] 送信結果の記録に失敗しました (${docId}):`,
      error
    );
  }
}

/** Firestore の「既に存在する」エラーか (code 6 = ALREADY_EXISTS)。 */
function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === 6 || code === "6" || code === "already-exists") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /already exists/i.test(message);
}
