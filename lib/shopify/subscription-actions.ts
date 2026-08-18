"use server";

import { getSession } from "./auth";
import {
  pauseSubscription,
  activateSubscription,
  cancelSubscription,
  skipNextBillingCycle,
  verifySubscriptionContractOwnership,
  isSubscriptionContractGid,
} from "./customer";
import { recordBillingCycleReset } from "./billing-cycle-reset";
import { updateSubscriptionContract } from "./subscription-admin";
import { reportSubscriptionFailure } from "./subscription-failure";
import { getAvailableFrequencyOptions } from "@/lib/subscription-frequencies.server";
import { STALE_BILLING_CYCLE_VIEW } from "@/lib/subscription-view";

import type { SellingPlanInterval } from "./admin-types";

type ActionResult = { success: boolean; error?: string };

/**
 * Generic failure message for anything the caller is not allowed to do.
 *
 * Deliberately identical for "contract does not exist", "contract belongs to
 * someone else" and "ownership could not be verified" so the response cannot be
 * used to probe which contract IDs exist on the store.
 */
const NOT_AUTHORIZED = "Subscription not found or not accessible";

async function getAccessToken(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  return session.accessToken;
}

/**
 * Authenticate the caller AND prove that they own `contractId`.
 *
 * Why this exists: these are Server Actions, so every exported function here is
 * a public HTTP endpoint. `contractId` arrives from the client and is not
 * trustworthy. Checking only "is someone logged in" lets any logged-in customer
 * operate on another customer's contract — the Admin API token used downstream
 * is store-wide and does not scope requests to the caller.
 *
 * Fail-closed: this throws unless ownership is positively proven. Verification
 * failures (network error, GraphQL error) are treated as "not the owner".
 *
 * Actions that call the Customer Account API with the customer's own token
 * (pause / activate / cancel / skip) are already scoped by Shopify to that
 * customer, so they do not need this extra round-trip. Actions that reach the
 * Admin API do.
 */
async function authorizeContractAccess(contractId: string): Promise<string> {
  const token = await getAccessToken();

  if (!isSubscriptionContractGid(contractId)) {
    throw new Error(NOT_AUTHORIZED);
  }

  const owned = await verifySubscriptionContractOwnership(token, contractId);
  if (!owned) {
    throw new Error(NOT_AUTHORIZED);
  }

  return token;
}

export async function pauseSubscriptionAction(contractId: string) {
  const token = await getAccessToken();
  return pauseSubscription(token, contractId);
}

/**
 * 定期便を再開する (PAUSED → ACTIVE)。
 *
 * 再開に成功したら**課金周期をリセットする**。課金失敗で自動停止した契約は
 * `nextBillingDate` が前進しないまま失敗履歴を抱えているので、リセットしないと
 * 翌日の課金 cron が「上限到達済み」と判定し、新しい課金を 1 度も試さずに再停止 +
 * 最終督促メールを送り直す (2026-08-11 の失敗系監査 High-1 の無限ループ)。
 *
 * リセットの記録は best-effort。失敗しても再開そのものは成功として返す
 * (記録できなかった場合の最悪ケースは従来と同じ「再開しても再停止する」であって、
 * 誤課金側には倒れない)。
 */
export async function activateSubscriptionAction(contractId: string) {
  const token = await getAccessToken();
  const result = await activateSubscription(token, contractId);

  if (result.success) {
    await recordBillingCycleReset(contractId, { reason: "customer-resume" });
  }

  return result;
}

export async function cancelSubscriptionAction(contractId: string) {
  const token = await getAccessToken();
  return cancelSubscription(token, contractId);
}

/**
 * Skip the next delivery.
 *
 * `billingCycleIndex` is intentionally not accepted from the client: the index
 * is resolved server-side from the contract's own upcoming billing cycles, so a
 * caller cannot aim the skip at an arbitrary cycle.
 *
 * `expectedNextBillingDate` は「顧客が画面で見ていたお届け予定日」。周期を狙う
 * ためのものではなく、**狙いがズレていたら中止する**ためだけに使う。別タブや
 * リロード後の再実行で、意図した周期の次まで黙って飛ぶ (連続 2 周期スキップ) のを
 * 防ぐ (2026-08-11 の失敗系監査 Medium-4)。
 *
 * 渡さない / 空のときは拒否する (fail-closed)。Server Action は公開 HTTP
 * エンドポイントなので、ガード無しで呼べる抜け道を残さない。ただし contractId の
 * 形式検証を先に通すのは従来どおり — 4 操作でエラー文言が割れて「その ID が実在
 * するか」を探れるオラクルにならないようにするため。
 */
export async function skipNextDeliveryAction(
  contractId: string,
  expectedNextBillingDate: string | null
): Promise<ActionResult> {
  if (!isSubscriptionContractGid(contractId)) {
    return { success: false, error: "Invalid subscription contract ID" };
  }

  const token = await getAccessToken();

  if (!expectedNextBillingDate) {
    return { success: false, error: STALE_BILLING_CYCLE_VIEW };
  }

  return skipNextBillingCycle(
    token,
    contractId,
    undefined,
    expectedNextBillingDate
  );
}

/**
 * Change the delivery/billing frequency of a subscription contract.
 * Uses the Admin API draft pattern (requires Admin API token).
 */
export async function changeDeliveryFrequencyAction(
  contractId: string,
  interval: SellingPlanInterval,
  intervalCount: number
): Promise<ActionResult> {
  // Validate input
  const validIntervals: SellingPlanInterval[] = ["DAY", "WEEK", "MONTH", "YEAR"];
  if (!validIntervals.includes(interval)) {
    return { success: false, error: "Invalid interval" };
  }
  if (!Number.isInteger(intervalCount) || intervalCount < 1 || intervalCount > 12) {
    return { success: false, error: "Invalid interval count" };
  }

  // 実在する selling plan に無い頻度は受けない。古い画面や作られたリクエストが
  // ストアに無いプランへ契約を移すのを防ぐ (画面側の絞り込みだけに頼らない)。
  const available = await getAvailableFrequencyOptions();
  if (
    !available.some(
      (option) =>
        option.interval === interval && option.intervalCount === intervalCount
    )
  ) {
    return { success: false, error: "Unsupported delivery frequency" };
  }

  // Authenticate the caller and prove they own this contract before touching
  // the store-wide Admin API.
  try {
    await authorizeContractAccess(contractId);
  } catch (error) {
    // 失敗理由は返さない。`verifySubscriptionContractOwnership` が自分で throw した
    // 場合 (Customer API のスロットル等) のメッセージには顧客 ID や外部 API の内部
    // 状態が入りうるため、返すのは常に同じ一般化文言にする。
    reportSubscriptionFailure("changeDeliveryFrequency:authorize", error, {
      impact: "customer sees the generic not-authorized message",
    });
    return { success: false, error: NOT_AUTHORIZED };
  }

  try {
    await updateSubscriptionContract(contractId, {
      deliveryPolicy: { interval, intervalCount },
      billingPolicy: { interval, intervalCount },
    });
    return { success: true };
  } catch (error) {
    // Shopify の生メッセージは返さない。`error` を載せないことで画面は自分の
    // ローカライズ済み文言 (`frequencyChangeError`) にフォールバックする。
    reportSubscriptionFailure("changeDeliveryFrequency", error, {
      impact: "customer sees the localized frequency-change failure message",
    });
    return { success: false };
  }
}
