import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  getSubscriptionContracts,
  createBillingAttempt,
} from "@/lib/shopify/subscription-admin";

/**
 * Cron-triggered billing processor.
 * Finds ACTIVE subscription contracts with nextBillingDate <= today
 * and creates billing attempts for each.
 *
 * Expected to be called by Vercel Cron (vercel.json) or external scheduler.
 * Protected by CRON_SECRET header check.
 */

const CRON_SECRET = process.env.CRON_SECRET || "";

export async function GET(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const results: {
    contractId: string;
    status: "success" | "error";
    detail?: string;
  }[] = [];

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
      });
    }

    // Process each due contract
    for (const contract of dueContracts) {
      // Idempotency key: contractId + billing date to prevent double charges
      const idempotencyKey = `${contract.id}-${contract.nextBillingDate}`;

      try {
        const attempt = await createBillingAttempt(contract.id, idempotencyKey);
        results.push({
          contractId: contract.id,
          status: attempt.errorCode ? "error" : "success",
          detail: attempt.errorMessage ?? undefined,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        results.push({
          contractId: contract.id,
          status: "error",
          detail: message,
        });

        Sentry.captureException(error, {
          tags: { cron: "billing" },
          extra: { contractId: contract.id },
        });
      }
    }

    const succeeded = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "error").length;

    console.log(
      `[Billing Cron] Processed ${dueContracts.length} contracts: ${succeeded} succeeded, ${failed} failed`
    );

    return NextResponse.json({
      checked: contracts.length,
      billed: dueContracts.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    Sentry.captureException(error, { tags: { cron: "billing" } });
    console.error("[Billing Cron] Fatal error:", error);
    return NextResponse.json(
      { error: "Billing cron failed" },
      { status: 500 }
    );
  }
}
