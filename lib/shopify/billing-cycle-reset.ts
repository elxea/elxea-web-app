/**
 * 定期便の「課金周期リセット」マーカー。
 *
 * ## なぜ必要か (2026-08-11 の失敗系監査 High-1)
 *
 * 課金が 3 回失敗した契約は自動で PAUSED になる。顧客が支払い方法を更新して
 * マイページから再開 (ACTIVE 復帰) しても、**失敗した契約の `nextBillingDate` は
 * 前進しない**ため、翌日の課金 cron は
 *
 *   1. 同じ請求日の周期を見る
 *   2. その周期には既に 3 件の失敗が残っている
 *   3. `failureCount >= MAX_RETRY_ATTEMPTS` が成立し、**新しい課金を 1 度も試さずに**
 *      再び PAUSED にして最終督促メールを送り直す
 *
 * という流れに入る。督促メールの「お支払い方法を更新後、マイページから再開して
 * いただけます」が機能しない誤案内になり、回収も止まる (無限再停止ループ)。
 *
 * ## このマーカーが表すもの
 *
 * 「この時刻より前の課金試行は、閉じた周期のものとして数えない」という境界。
 * 顧客が再開したときにだけ書き、課金 cron が読む。`analyzeBillingCycle` は
 * このマーカーを集計窓の下限として使うので、再開後は失敗件数が 0 に戻り、
 * cron は**新しい課金試行を 1 回作る** (更新後の支払い方法で引き落とせる)。
 *
 * ## 安全側の倒し方 (誤課金を作らないための規律)
 *
 *  - 読み取りが失敗したら `null` を返す = マーカー無し = 従来の判定。従来の判定は
 *    「上限到達なら停止」であって課金を足さないので、Firestore 障害が誤課金に化けない。
 *  - 書き込みが失敗しても顧客の再開操作は止めない (best-effort)。書けなかった場合の
 *    結果は「再開したのに再停止する」= 従来の欠陥のままで、誤課金側には倒れない。
 *  - マーカーは**周期の内側にあるときだけ**効かせる (`analyzeBillingCycle` 側の判定)。
 *    古いマーカーが残っていても次の周期の判定を歪めない。
 *  - 二重課金は Shopify の idempotencyKey が最終防衛線。リセット後の鍵には
 *    リセット時刻を混ぜる (`app/api/cron/billing/route.ts`) ので、
 *    「同じ日に cron が二重発火 → 同じ鍵 → Shopify が重複を拒否」は維持される。
 *
 * ## 運用要件
 *
 * `_subscriptionCycleResets` に TTL ポリシー (フィールド `ttl`) を設定する。
 * 課金周期は最長でも 1 年なので、保持は 90 日で足りる。
 *   gcloud firestore fields ttls update ttl \
 *     --collection-group=_subscriptionCycleResets --enable-ttl
 */
import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/log";

/** マーカーの置き場。`_` 始まりは運用用コレクションの既存慣習 (`_webhookLogs`)。 */
export const CYCLE_RESET_COLLECTION = "_subscriptionCycleResets";

/** マーカーの保持期間 (日)。Firestore TTL が `ttl` フィールドで消す。 */
export const CYCLE_RESET_TTL_DAYS = 90;

const SUBSCRIPTION_CONTRACT_GID = /^gid:\/\/shopify\/SubscriptionContract\/(\d+)$/;

/**
 * 契約 GID から doc ID (数値サフィックス) を作る。
 * `/` を含む GID をそのまま doc ID にはできないため。形が違えば `null` を返し、
 * 呼び出し側は「マーカー無し」として扱う (勝手に正規化しない)。
 */
export function cycleResetDocId(contractId: string): string | null {
  const match = SUBSCRIPTION_CONTRACT_GID.exec(contractId);
  return match ? match[1] : null;
}

/**
 * 課金周期をリセットする (顧客が契約を再開したとき)。
 *
 * 戻り値は「記録できたか」。失敗しても throw しない — 呼び出し元は顧客の再開操作で、
 * マーカーが書けなかったからといって再開自体を失敗にはしない。
 */
export async function recordBillingCycleReset(
  contractId: string,
  options?: { at?: Date; reason?: string }
): Promise<boolean> {
  const docId = cycleResetDocId(contractId);
  if (!docId) {
    console.warn(
      `[BillingCycleReset] 契約 ID の形が不正なため記録しません: ${contractId}`
    );
    return false;
  }

  const at = options?.at ?? new Date();
  if (!Number.isFinite(at.getTime())) return false;

  try {
    const { Timestamp } = await import("firebase-admin/firestore");
    await getAdminFirestore()
      .collection(CYCLE_RESET_COLLECTION)
      .doc(docId)
      .set({
        contractId,
        reason: options?.reason ?? "customer-resume",
        // 読み取り側は ISO 文字列を優先して使う (Timestamp 実装に依存しない)。
        resetAtIso: at.toISOString(),
        resetAt: Timestamp.fromDate(at),
        ttl: Timestamp.fromDate(
          new Date(at.getTime() + CYCLE_RESET_TTL_DAYS * 24 * 60 * 60 * 1000)
        ),
      });
    return true;
  } catch (error) {
    /* 再開操作そのものは成功させる。ここで throw すると顧客が「再開できない」に化ける。
       ただしマーカーが書けていないと、再開したはずの契約が翌日また停止する
       (このファイルが直している欠陥そのもの) ので、必ず届く形で残す。 */
    logger.error("shopify.billing-cycle-reset.write-failed", error, {
      contractId,
    });
    return false;
  }
}

/**
 * 課金周期リセットの時刻を読む。
 *
 * マーカーが無い / 読めない / 壊れている場合は `null`。`null` は「リセット無し」=
 * 従来の判定 (課金を足さない側) を意味するので、Firestore 障害が誤課金にならない。
 */
export async function getBillingCycleResetAt(
  contractId: string
): Promise<Date | null> {
  const docId = cycleResetDocId(contractId);
  if (!docId) return null;

  try {
    const snapshot = await getAdminFirestore()
      .collection(CYCLE_RESET_COLLECTION)
      .doc(docId)
      .get();

    if (!snapshot.exists) return null;

    const data = snapshot.data() as
      | { resetAtIso?: unknown; resetAt?: unknown }
      | undefined;
    if (!data) return null;

    return toDate(data.resetAtIso) ?? toDate(data.resetAt);
  } catch (error) {
    /* 読めないときは「マーカー無し」= 従来の判定に倒す (誤課金側には倒れない)。
       とはいえ再開済みの契約が再停止する側の間違いなので、黙って落とさない。 */
    logger.error("shopify.billing-cycle-reset.read-failed", error, {
      contractId,
    });
    return null;
  }
}

/** ISO 文字列 / Firestore Timestamp / Date のいずれからでも Date を作る。 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    try {
      const date = (value as { toDate: () => Date }).toDate();
      return date instanceof Date && Number.isFinite(date.getTime())
        ? date
        : null;
    } catch (error) {
      /* 保存したのはこちら側の値なので、読めないのは壊れているということ。
         マーカー無し扱いで進めるが、原因は追えるようにしておく。 */
      logger.error("shopify.billing-cycle-reset.timestamp-unreadable", error);
      return null;
    }
  }
  return null;
}
