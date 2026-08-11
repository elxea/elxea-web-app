import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  getSubscriptionContracts,
  getSubscriptionContract,
  createBillingAttempt,
  getBillingAttempts,
  updateSubscriptionContract,
} from "@/lib/shopify/subscription-admin";
import { sendDunningEmail } from "@/lib/email/dunning";
import {
  notifyBillingCronFatal,
  notifyBillingRunFailures,
  notifySubscriptionPaused,
} from "@/lib/line/monitoring-alerts";
import {
  analyzeBillingCycle,
  isReadyForRetry,
  isStaleInFlight,
  MAX_RETRY_ATTEMPTS,
} from "@/lib/shopify/billing-dunning";

/**
 * Cron-triggered billing processor with dunning (retry) logic.
 *
 * Flow:
 * 1. Find ACTIVE contracts with nextBillingDate <= today
 * 2. For each, check this cycle's billing attempts to determine retry state
 * 3. If the cycle is already charged or an attempt is still in flight: do nothing
 * 4. If no prior failures for this billing cycle: create initial billing attempt
 * 5. If prior failures exist and enough time has passed (24h intervals): retry
 * 6. After 3 total failures: pause the contract and notify customer
 *
 * Retry schedule: initial attempt, then +24h, +48h, +72h (max 3 retries)
 *
 * 「この周期の試行」の切り出しは `lib/shopify/billing-dunning.ts` の
 * `analyzeBillingCycle` が持つ。失敗の集計窓に上限を置くと、失敗中に前進しない
 * `nextBillingDate` のせいで古い契約の失敗が数え落とされ、上限到達も一時停止も
 * 起きず毎日再課金と督促メールが続く (2026-08-11 の障害)。窓の根拠は同ファイル参照。
 *
 * Expected to be called by Vercel Cron (vercel.json) daily.
 * Protected by CRON_SECRET header check.
 */

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * Outcome of one contract in one cron run.
 *
 * `action` is the machine-readable verdict and must never overstate the result:
 * a charge that came back with an `errorCode` is `failed` / `retry_failed`, and
 * one Shopify has only *accepted* (asynchronous, `ready: false`) is `pending` —
 * not `billed`. Until 2026-08 a failed charge was reported as `billed`/`retried`
 * with the failure buried in `detail`, so every monitor reading `action` (and the
 * `billed` count in the summary) saw a successful run while nothing was charged.
 *
 *  - `billed`       first charge confirmed complete
 *  - `retried`      retry charge confirmed complete
 *  - `pending`      attempt accepted by Shopify, outcome not yet known; the real
 *                   result arrives on the subscription_billing_attempts/success
 *                   | failure webhook (app/api/subscription/webhook)
 *  - `failed`       first charge returned an errorCode
 *  - `retry_failed` retry charge returned an errorCode
 *  - `paused`       retry budget exhausted, contract paused
 *  - `waiting`      inside the retry interval, nothing attempted
 *  - `skipped`      not billable (no billing date)
 *  - `error`        unexpected exception while processing
 */
type BillingAction =
  | "billed"
  | "retried"
  | "pending"
  | "failed"
  | "retry_failed"
  | "paused"
  | "waiting"
  | "skipped"
  | "error";

type BillingResult = {
  contractId: string;
  action: BillingAction;
  attemptNumber?: number;
  detail?: string;
};

/**
 * Timing-safe comparison of the incoming Authorization header against the
 * expected Bearer token. Uses constant-time comparison after a length check
 * to prevent timing side-channel attacks on the shared secret.
 */
function isAuthorizedCronRequest(authHeader: string | null): boolean {
  if (!CRON_SECRET || !authHeader) return false;
  const expected = `Bearer ${CRON_SECRET}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  // Auth check — use constant-time comparison
  const authHeader = request.headers.get("authorization");
  if (!isAuthorizedCronRequest(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const results: BillingResult[] = [];

  try {
    // Fetch all ACTIVE contracts
    const contracts = await getSubscriptionContracts("ACTIVE");

    // Filter to contracts whose nextBillingDate is today or past
    const dueContracts = contracts.filter((c) => {
      if (!c.nextBillingDate) return false;
      return new Date(c.nextBillingDate) <= now;
    });

    if (dueContracts.length === 0) {
      return NextResponse.json({
        message: "No contracts due for billing",
        checked: contracts.length,
        billed: 0,
        results: [],
      });
    }

    // Process each due contract
    for (const contract of dueContracts) {
      try {
        const result = await processContract(contract, now);
        results.push(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        results.push({
          contractId: contract.id,
          action: "error",
          detail: message,
        });

        Sentry.captureException(error, {
          tags: { cron: "billing", phase: "processing" },
          extra: { contractId: contract.id },
        });
      }
    }

    const count = (action: BillingAction) =>
      results.filter((r) => r.action === action).length;

    const summary = {
      checked: contracts.length,
      due: dueContracts.length,
      billed: count("billed"),
      retried: count("retried"),
      pending: count("pending"),
      failed: count("failed"),
      retry_failed: count("retry_failed"),
      paused: count("paused"),
      waiting: count("waiting"),
      skipped: count("skipped"),
      errors: count("error"),
    };

    console.log(`[Billing Cron] Summary:`, JSON.stringify(summary));

    // 運営宛の監視通知。Sentry は「記録」で、こちらは「その場で気づく」ための経路。
    // 失敗が 1 件でもあれば run 単位で 1 通だけ送る (契約ごとに送ると失敗が並んだ
    // 日に通知が溢れて読まれなくなる)。PAUSE は個別に送るのでここには数えない。
    const failureTotal = summary.failed + summary.retry_failed + summary.errors;
    if (failureTotal > 0) {
      // `.catch` は保険。monitoring-alerts は例外を外に出さないが、この await は
      // 外側の try の内側にあるため、万一漏れると「通知の失敗」が「cron の失敗」
      // (500 + 異常終了通知) に化ける。その化学変化をここで断つ。
      await notifyBillingRunFailures({
        due: summary.due,
        failed: summary.failed,
        retryFailed: summary.retry_failed,
        errors: summary.errors,
        contractIds: results
          .filter(
            (r) =>
              r.action === "failed" ||
              r.action === "retry_failed" ||
              r.action === "error"
          )
          .map((r) => r.contractId),
      }).catch((notifyError) =>
        console.error("[Billing Cron] 監視通知の送出に失敗しました:", notifyError)
      );
    }

    return NextResponse.json({ ...summary, results });
  } catch (error) {
    Sentry.captureException(error, { tags: { cron: "billing" } });
    console.error("[Billing Cron] Fatal error:", error);
    // 「今日の課金が走っていない」ことは記録だけでは気づけないので運営へ push。
    // notify 側は例外を外に出さないので、この通知が 500 応答を妨げることはない。
    await notifyBillingCronFatal({
      message: error instanceof Error ? error.message : "Unknown error",
    }).catch((notifyError) =>
      console.error("[Billing Cron] 異常終了通知の送出に失敗しました:", notifyError)
    );
    return NextResponse.json(
      { error: "Billing cron failed" },
      { status: 500 }
    );
  }
}

async function processContract(
  contract: { id: string; nextBillingDate: string | null },
  now: Date
): Promise<BillingResult> {
  if (!contract.nextBillingDate) {
    return {
      contractId: contract.id,
      action: "skipped",
      detail: "No billing date",
    };
  }

  // この周期の試行履歴から現在地を出す。判定は lib/shopify/billing-dunning に閉じている
  // (窓の設計と、そこを間違えたときに何が起きたかは同ファイルの冒頭を参照)。
  const attempts = await getBillingAttempts(contract.id);
  const cycle = analyzeBillingCycle(attempts, contract.nextBillingDate);

  // Case 0: 請求日が日時として読めない。判定の基準が無いので課金しない。
  if (!cycle.billingDateValid) {
    Sentry.captureMessage("[Billing Cron] Unparseable nextBillingDate", {
      level: "warning",
      tags: { cron: "billing", phase: "cycle-analysis" },
      extra: { contractId: contract.id, nextBillingDate: contract.nextBillingDate },
    });
    return {
      contractId: contract.id,
      action: "skipped",
      detail: `Unparseable billing date: ${contract.nextBillingDate}`,
    };
  }

  // Case 1: この周期の課金は既に完了している。二重課金しない。
  // (成功していれば Shopify 側で nextBillingDate が前進するので通常ここには来ないが、
  //  前進が遅れている間に cron が回っても課金を重ねないための歯止め)
  if (cycle.completedAt) {
    return {
      contractId: contract.id,
      action: "skipped",
      detail: `Already charged for this cycle at ${cycle.completedAt.toISOString()}`,
    };
  }

  // Case 2: 試行が結果待ち。成否が確定するまで課金しない (確定は webhook 経由)。
  if (cycle.inFlightAt) {
    // 待ち続けるだけだと無音で課金が止まるので、長すぎる滞留は運営に見えるようにする。
    if (isStaleInFlight(cycle.inFlightAt, now)) {
      Sentry.captureMessage("[Billing Cron] Billing attempt stuck in flight", {
        level: "warning",
        tags: { cron: "billing", phase: "in-flight" },
        extra: {
          contractId: contract.id,
          inFlightSince: cycle.inFlightAt.toISOString(),
        },
      });
    }
    return {
      contractId: contract.id,
      action: "skipped",
      detail: `Attempt still processing since ${cycle.inFlightAt.toISOString()}`,
    };
  }

  // Case 3: リトライ上限に到達 -- 契約を一時停止する。
  // 窓に上限が無いので、請求日から何日経っていても失敗は数え落とされずここに入る。
  if (cycle.failureCount >= MAX_RETRY_ATTEMPTS) {
    return handleMaxRetriesExceeded(contract);
  }

  // Case 4: 失敗はあるが時刻が読めない。間隔を判断できないので課金しない。
  if (cycle.failureCount > 0 && !cycle.lastFailureAt) {
    return {
      contractId: contract.id,
      action: "skipped",
      attemptNumber: cycle.failureCount,
      detail: `Cannot determine retry timing (${cycle.failureCount} failures with unreadable timestamps)`,
    };
  }

  // Case 5: 失敗あり。リトライ間隔を満たしていれば再試行する。
  if (cycle.failureCount > 0 && cycle.lastFailureAt) {
    if (!isReadyForRetry(cycle.lastFailureAt, now)) {
      return {
        contractId: contract.id,
        action: "waiting",
        attemptNumber: cycle.failureCount,
        detail: `Waiting for retry interval (${cycle.failureCount} failures, last at ${cycle.lastFailureAt.toISOString()})`,
      };
    }
    return performBillingAttempt(contract, cycle.failureCount + 1);
  }

  // Case 6: この周期の初回試行
  return performBillingAttempt(contract, 1);
}

async function performBillingAttempt(
  contract: { id: string; nextBillingDate: string | null },
  attemptNumber: number
): Promise<BillingResult> {
  // Idempotency key: contractId + billing date + attempt number
  const idempotencyKey = `${contract.id}-${contract.nextBillingDate}-attempt${attemptNumber}`;

  const isRetry = attemptNumber > 1;
  const attempt = await createBillingAttempt(contract.id, idempotencyKey);

  if (attempt.errorCode) {
    // Billing failed - send dunning notification
    console.warn(
      `[Billing Cron] Attempt ${attemptNumber} failed for ${contract.id}: ${attempt.errorMessage}`
    );

    await sendDunningNotification(contract.id, attemptNumber, false);

    return {
      contractId: contract.id,
      action: isRetry ? "retry_failed" : "failed",
      attemptNumber,
      detail: `Failed: ${attempt.errorMessage ?? attempt.errorCode}`,
    };
  }

  // No errorCode, but Shopify processes billing attempts asynchronously and
  // returns `ready: false` while the charge is still in flight. That is not a
  // completed charge, so it must not be counted as one — the definitive result
  // arrives on the subscription_billing_attempts/success|failure webhook.
  if (!attempt.ready) {
    return {
      contractId: contract.id,
      action: "pending",
      attemptNumber,
      detail: `Accepted, awaiting result (attempt ${attempt.id})`,
    };
  }

  return {
    contractId: contract.id,
    action: isRetry ? "retried" : "billed",
    attemptNumber,
    detail: "Success",
  };
}

async function handleMaxRetriesExceeded(
  contract: { id: string; nextBillingDate: string | null }
): Promise<BillingResult> {
  console.warn(
    `[Billing Cron] Max retries exceeded for ${contract.id}, pausing contract`
  );

  try {
    // Pause the contract via the Admin API draft pattern
    await updateSubscriptionContract(contract.id, { status: "PAUSED" });

    // Send final dunning email
    await sendDunningNotification(contract.id, MAX_RETRY_ATTEMPTS, true);

    // 契約が止まったことは運営が個別に把握すべき状態変化なので、run 集約とは別に送る
    // (顧客への最終案内より後に置く。運営通知が顧客対応を遅らせない順序)。
    // `.catch` は保険。ここは try の内側なので、通知が漏れると停止に成功した契約が
    // action=error として申告されてしまう (実態と申告のずれ = この route が 2026-08 に
    // 直したのと同じ種類の欠陥)。
    await notifySubscriptionPaused({
      contractId: contract.id,
      failureCount: MAX_RETRY_ATTEMPTS,
    }).catch((notifyError) =>
      console.error("[Billing Cron] 契約停止通知の送出に失敗しました:", notifyError)
    );

    return {
      contractId: contract.id,
      action: "paused",
      attemptNumber: MAX_RETRY_ATTEMPTS,
      detail: "Contract paused after max retries",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    Sentry.captureException(error, {
      tags: { cron: "billing", phase: "pause" },
      extra: { contractId: contract.id },
    });
    return {
      contractId: contract.id,
      action: "error",
      attemptNumber: MAX_RETRY_ATTEMPTS,
      detail: `Failed to pause contract: ${message}`,
    };
  }
}

async function sendDunningNotification(
  contractId: string,
  attemptNumber: number,
  isFinalAttempt: boolean
): Promise<void> {
  try {
    // Fetch full contract details for email data
    const fullContract = await getSubscriptionContract(contractId);

    if (!fullContract.customer?.email) {
      console.warn(
        `[Billing Cron] No customer email for contract ${contractId}, skipping dunning email`
      );
      return;
    }

    const items = fullContract.lines.map((line) => ({
      title: line.title,
      quantity: line.quantity,
      price: line.currentPrice.amount,
      currencyCode: line.currentPrice.currencyCode,
    }));

    await sendDunningEmail({
      customerEmail: fullContract.customer.email,
      customerName: fullContract.customer.displayName,
      attemptNumber,
      isFinalAttempt,
      items,
    });

    console.log(
      `[Billing Cron] Dunning email sent for ${contractId} (attempt ${attemptNumber}, final: ${isFinalAttempt})`
    );
  } catch (error) {
    // Non-critical: log but don't fail the billing process
    console.error(
      `[Billing Cron] Failed to send dunning email for ${contractId}:`,
      error
    );
    Sentry.captureException(error, {
      tags: { cron: "billing", phase: "dunning-email" },
      extra: { contractId, attemptNumber },
    });
  }
}
