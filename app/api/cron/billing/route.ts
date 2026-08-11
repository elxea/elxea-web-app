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
import { getBillingCycleResetAt } from "@/lib/shopify/billing-cycle-reset";

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
 * 逆向きの欠陥 (再開しても即再停止する無限ループ) は、顧客の再開時に書かれる
 * 周期リセットのマーカー (`lib/shopify/billing-cycle-reset.ts`) を窓の下限として
 * 使うことで閉じている。再開後は失敗件数が 0 に戻り、この cron が更新後の支払い
 * 方法で 1 回課金を試す。リセットが効いている周期の idempotencyKey には
 * リセット時刻を混ぜる (前の周期と同じ鍵になって Shopify に弾かれないため)。
 *
 * 督促メールの送信可否は**申告に必ず反映する**。`sendDunningEmail` は失敗を
 * 例外ではなく `{ success: false }` で返すので、戻り値を見ずに「送信済み」と
 * ログするとメール不着が完全に沈黙する (2026-08-11 の失敗系監査 High-2)。
 * 失敗は Sentry に上げ、summary の `dunning_email_failed` に計上し、運営宛の
 * 停止通知にも「顧客へ届いていない」ことをそのまま載せる。
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
  /**
   * 顧客への督促メールを送れなかった (Resend がエラー応答 / 例外 / 宛先不明)。
   * `action` とは独立した軸なので別フィールドにする — 課金の申告を歪めずに、
   * 「顧客が知らされていない」を summary と監視に必ず出すため。
   */
  dunningEmailFailed?: boolean;
};

/** 督促メール 1 通ぶんの結末。送れなかったことを呼び出し側に必ず返す。 */
type DunningNotifyOutcome = { notified: boolean; reason?: string };

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
      // 「顧客に届かなかった督促メール」の件数。action とは独立に数える
      // (課金は正しく失敗と申告されているのに、顧客だけが知らない状態を隠さない)。
      dunning_email_failed: results.filter((r) => r.dunningEmailFailed).length,
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
  //
  // 顧客が再開していれば、その時刻より前の失敗は閉じた周期のものとして数えない。
  // 読めなければ null = 従来判定 (課金を足さない側) なので、Firestore 障害が
  // 誤課金に化けることはない。
  const [attempts, cycleResetAt] = await Promise.all([
    getBillingAttempts(contract.id),
    getBillingCycleResetAt(contract.id),
  ]);
  const cycle = analyzeBillingCycle(attempts, contract.nextBillingDate, {
    cycleResetAt,
  });

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
  // ただし顧客が再開していれば、リセット後に積み直した失敗だけがここに数えられる
  // (再開直後は 0 件なので、必ず新しい課金試行が 1 回走ってから停止に入る)。
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
    return performBillingAttempt(
      contract,
      cycle.failureCount + 1,
      cycle.cycleResetAt
    );
  }

  // Case 6: この周期の初回試行
  return performBillingAttempt(contract, 1, cycle.cycleResetAt);
}

/**
 * Shopify に渡す idempotency key。
 *
 * 通常は `contractId + 請求日 + 試行番号`。周期リセット (顧客の再開) が効いている
 * 間は**リセット時刻も混ぜる** — 混ぜないと再開後の 1 回目が停止前の 1 回目と同じ鍵に
 * なり、Shopify 側の重複判定で新しい課金が作られないため。同じ日に cron が二重発火
 * したときは鍵が一致する (= 重複が拒否される) 性質はそのまま維持される。
 */
function buildIdempotencyKey(
  contract: { id: string; nextBillingDate: string | null },
  attemptNumber: number,
  cycleResetAt: Date | null
): string {
  const base = `${contract.id}-${contract.nextBillingDate}`;
  const reset = cycleResetAt ? `-reset${cycleResetAt.getTime()}` : "";
  return `${base}${reset}-attempt${attemptNumber}`;
}

async function performBillingAttempt(
  contract: { id: string; nextBillingDate: string | null },
  attemptNumber: number,
  cycleResetAt: Date | null
): Promise<BillingResult> {
  const idempotencyKey = buildIdempotencyKey(
    contract,
    attemptNumber,
    cycleResetAt
  );

  const isRetry = attemptNumber > 1;
  const attempt = await createBillingAttempt(contract.id, idempotencyKey);

  if (attempt.errorCode) {
    // Billing failed - send dunning notification
    console.warn(
      `[Billing Cron] Attempt ${attemptNumber} failed for ${contract.id}: ${attempt.errorMessage}`
    );

    const notify = await sendDunningNotification(
      contract.id,
      attemptNumber,
      false
    );

    return {
      contractId: contract.id,
      action: isRetry ? "retry_failed" : "failed",
      attemptNumber,
      detail: `Failed: ${attempt.errorMessage ?? attempt.errorCode}${
        notify.notified ? "" : ` (dunning email not sent: ${notify.reason})`
      }`,
      ...(notify.notified ? {} : { dunningEmailFailed: true }),
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
    const notify = await sendDunningNotification(
      contract.id,
      MAX_RETRY_ATTEMPTS,
      true
    );

    // 契約が止まったことは運営が個別に把握すべき状態変化なので、run 集約とは別に送る
    // (顧客への最終案内より後に置く。運営通知が顧客対応を遅らせない順序)。
    // `.catch` は保険。ここは try の内側なので、通知が漏れると停止に成功した契約が
    // action=error として申告されてしまう (実態と申告のずれ = この route が 2026-08 に
    // 直したのと同じ種類の欠陥)。
    //
    // `customerNotified` は最終督促メールの実結果をそのまま渡す。ここを固定文で
    // 「送信済み」と書くと、メールが届いていない契約まで運営が「案内済み」と誤認する
    // (2026-08-11 の失敗系監査 High-2 の後半)。
    await notifySubscriptionPaused({
      contractId: contract.id,
      failureCount: MAX_RETRY_ATTEMPTS,
      customerNotified: notify.notified,
    }).catch((notifyError) =>
      console.error("[Billing Cron] 契約停止通知の送出に失敗しました:", notifyError)
    );

    return {
      contractId: contract.id,
      action: "paused",
      attemptNumber: MAX_RETRY_ATTEMPTS,
      detail: notify.notified
        ? "Contract paused after max retries"
        : `Contract paused after max retries (final dunning email not sent: ${notify.reason})`,
      ...(notify.notified ? {} : { dunningEmailFailed: true }),
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

/**
 * 顧客へ督促メールを送り、**送れたかどうかを必ず返す**。
 *
 * `sendDunningEmail` は Resend のエラー応答を例外にせず `{ success: false }` で返す。
 * 以前はこの戻り値を見ずに「Dunning email sent」とログしていたため、メール不着が
 * どこにも現れず (Sentry にも LINE にも乗らず)、運営は送信済みと誤認していた
 * (2026-08-11 の失敗系監査 High-2)。
 *
 * 送れなかった 3 経路 — 宛先が無い / Resend がエラー応答 / 例外 — をすべて
 * `notified: false` に畳み、Sentry に上げる。課金処理そのものは止めない
 * (メールが送れないことは課金の失敗ではない)。
 */
async function sendDunningNotification(
  contractId: string,
  attemptNumber: number,
  isFinalAttempt: boolean
): Promise<DunningNotifyOutcome> {
  try {
    // Fetch full contract details for email data
    const fullContract = await getSubscriptionContract(contractId);

    if (!fullContract.customer?.email) {
      console.warn(
        `[Billing Cron] No customer email for contract ${contractId}, skipping dunning email`
      );
      Sentry.captureMessage("[Billing Cron] Dunning email not sent", {
        level: "warning",
        tags: { cron: "billing", phase: "dunning-email" },
        extra: {
          contractId,
          attemptNumber,
          isFinalAttempt,
          reason: "no customer email",
        },
      });
      return { notified: false, reason: "no customer email" };
    }

    const items = fullContract.lines.map((line) => ({
      title: line.title,
      quantity: line.quantity,
      price: line.currentPrice.amount,
      currencyCode: line.currentPrice.currencyCode,
    }));

    const sendResult = await sendDunningEmail({
      customerEmail: fullContract.customer.email,
      customerName: fullContract.customer.displayName,
      attemptNumber,
      isFinalAttempt,
      items,
    });

    // 戻り値を必ず見る。`success: false` を握り潰すと顧客も運営も気づけない。
    if (sendResult && sendResult.success === false) {
      const reason = sendResult.error ?? "unknown send error";
      console.error(
        `[Billing Cron] Dunning email NOT sent for ${contractId} (attempt ${attemptNumber}): ${reason}`
      );
      Sentry.captureMessage("[Billing Cron] Dunning email not sent", {
        level: "error",
        tags: { cron: "billing", phase: "dunning-email" },
        extra: { contractId, attemptNumber, isFinalAttempt, reason },
      });
      return { notified: false, reason };
    }

    console.log(
      `[Billing Cron] Dunning email sent for ${contractId} (attempt ${attemptNumber}, final: ${isFinalAttempt})`
    );
    return { notified: true };
  } catch (error) {
    // Non-critical for billing itself: 課金処理は止めないが、顧客に届いていない
    // ことは申告に必ず残す (呼び出し側が summary と停止通知に反映する)。
    const reason = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[Billing Cron] Failed to send dunning email for ${contractId}:`,
      error
    );
    Sentry.captureException(error, {
      tags: { cron: "billing", phase: "dunning-email" },
      extra: { contractId, attemptNumber },
    });
    return { notified: false, reason };
  }
}
