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

/**
 * Cron-triggered billing processor with dunning (retry) logic.
 *
 * Flow:
 * 1. Find ACTIVE contracts with nextBillingDate <= today
 * 2. For each, check recent billing attempts to determine retry state
 * 3. If no prior failures for this billing cycle: create initial billing attempt
 * 4. If prior failures exist and enough time has passed (24h intervals): retry
 * 5. After 3 total failures: pause the contract and notify customer
 *
 * Retry schedule: initial attempt, then +24h, +48h, +72h (max 3 retries)
 *
 * Expected to be called by Vercel Cron (vercel.json) daily.
 * Protected by CRON_SECRET header check.
 */

const CRON_SECRET = process.env.CRON_SECRET || "";
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_INTERVAL_HOURS = 24;

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
 * Count recent failed billing attempts for a given billing date.
 * Only counts attempts created within the dunning window (MAX_RETRY_ATTEMPTS * RETRY_INTERVAL_HOURS)
 * that have an error code, to isolate failures for the current billing cycle.
 */
function countRecentFailures(
  attempts: { id: string; createdAt: string; errorCode: string | null; errorMessage: string | null }[],
  billingDate: string
): { failureCount: number; lastFailureAt: Date | null } {
  const billingDateMs = new Date(billingDate).getTime();
  // Look at attempts within the dunning window from the billing date
  const windowMs = (MAX_RETRY_ATTEMPTS + 1) * RETRY_INTERVAL_HOURS * 60 * 60 * 1000;

  const recentFailures = attempts.filter((a) => {
    if (!a.errorCode) return false;
    const attemptMs = new Date(a.createdAt).getTime();
    // Must be after billing date (or same day) and within the retry window
    return attemptMs >= billingDateMs - 24 * 60 * 60 * 1000 && attemptMs <= billingDateMs + windowMs;
  });

  const sorted = recentFailures.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    failureCount: recentFailures.length,
    lastFailureAt: sorted.length > 0 ? new Date(sorted[0]!.createdAt) : null,
  };
}

/**
 * Check if enough time has passed since the last failure to retry.
 */
function isReadyForRetry(lastFailureAt: Date, now: Date): boolean {
  const hoursSinceFailure =
    (now.getTime() - lastFailureAt.getTime()) / (1000 * 60 * 60);
  return hoursSinceFailure >= RETRY_INTERVAL_HOURS;
}

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

    return NextResponse.json({ ...summary, results });
  } catch (error) {
    Sentry.captureException(error, { tags: { cron: "billing" } });
    console.error("[Billing Cron] Fatal error:", error);
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

  // Get existing billing attempts to check retry state
  const attempts = await getBillingAttempts(contract.id);
  const { failureCount, lastFailureAt } = countRecentFailures(
    attempts,
    contract.nextBillingDate
  );

  // Case 1: Max retries exceeded -- pause the contract
  if (failureCount >= MAX_RETRY_ATTEMPTS) {
    return handleMaxRetriesExceeded(contract);
  }

  // Case 2: Has previous failures, check if ready to retry
  if (failureCount > 0 && lastFailureAt) {
    if (!isReadyForRetry(lastFailureAt, now)) {
      return {
        contractId: contract.id,
        action: "waiting",
        attemptNumber: failureCount,
        detail: `Waiting for retry interval (${failureCount} failures, last at ${lastFailureAt.toISOString()})`,
      };
    }
    // Ready to retry
    return performBillingAttempt(contract, failureCount + 1);
  }

  // Case 3: First attempt
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
