import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getSubscriptionContracts } from "@/lib/shopify/subscription-admin";
import { sendSubscriptionReminder } from "@/lib/email/subscription-reminder";

/**
 * Cron-triggered subscription renewal reminder.
 * Finds ACTIVE subscription contracts with nextBillingDate within the
 * reminder window (default: 3 days ahead) and sends reminder emails.
 *
 * Expected to be called daily by Vercel Cron (vercel.json).
 * Protected by CRON_SECRET header check.
 */

const CRON_SECRET = process.env.CRON_SECRET || "";
const REMINDER_DAYS_BEFORE = 3;

function formatInterval(interval: string, intervalCount: number): string {
  const intervalMap: Record<string, string> = {
    DAY: "日",
    WEEK: "週",
    MONTH: "ヶ月",
    YEAR: "年",
  };

  const unit = intervalMap[interval] || interval;

  if (interval === "MONTH" && intervalCount === 1) return "毎月";
  if (interval === "MONTH" && intervalCount === 2) return "隔月";
  if (interval === "WEEK" && intervalCount === 1) return "毎週";
  if (interval === "WEEK" && intervalCount === 2) return "隔週";

  return `${intervalCount}${unit}ごと`;
}

export async function GET(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: {
    contractId: string;
    customerEmail: string;
    status: "sent" | "skipped" | "error";
    detail?: string;
  }[] = [];

  try {
    // Fetch all ACTIVE contracts
    const contracts = await getSubscriptionContracts("ACTIVE");

    // Calculate reminder window: contracts billing in exactly REMINDER_DAYS_BEFORE days
    const now = new Date();
    const reminderDate = new Date(now);
    reminderDate.setDate(reminderDate.getDate() + REMINDER_DAYS_BEFORE);

    // Normalize to date-only comparison (ignore time)
    const reminderDateStr = reminderDate.toISOString().slice(0, 10);

    const dueContracts = contracts.filter((c) => {
      if (!c.nextBillingDate) return false;
      const billingDateStr = new Date(c.nextBillingDate)
        .toISOString()
        .slice(0, 10);
      return billingDateStr === reminderDateStr;
    });

    if (dueContracts.length === 0) {
      return NextResponse.json({
        message: "No contracts due for reminder",
        checked: contracts.length,
        reminderDate: reminderDateStr,
        sent: 0,
      });
    }

    // Send reminders
    for (const contract of dueContracts) {
      const customerEmail = contract.customer?.email;
      if (!customerEmail) {
        results.push({
          contractId: contract.id,
          customerEmail: "",
          status: "skipped",
          detail: "No customer email",
        });
        continue;
      }

      const customerName =
        contract.customer?.displayName || customerEmail.split("@")[0];

      const items = contract.lines.map((line) => ({
        title: line.title,
        quantity: line.quantity,
        price: line.currentPrice.amount,
        currencyCode: line.currentPrice.currencyCode,
      }));

      const deliveryInterval = formatInterval(
        contract.deliveryPolicy.interval,
        contract.deliveryPolicy.intervalCount
      );

      try {
        const result = await sendSubscriptionReminder({
          customerEmail,
          customerName,
          nextBillingDate: contract.nextBillingDate!,
          items,
          deliveryInterval,
        });

        results.push({
          contractId: contract.id,
          customerEmail,
          status: result.success ? "sent" : "error",
          detail: result.error,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        results.push({
          contractId: contract.id,
          customerEmail,
          status: "error",
          detail: message,
        });

        Sentry.captureException(error, {
          tags: { cron: "subscription-reminder" },
          extra: { contractId: contract.id, customerEmail },
        });
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const errors = results.filter((r) => r.status === "error").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    console.log(
      `[Subscription Reminder] Processed ${dueContracts.length} contracts: ${sent} sent, ${errors} errors, ${skipped} skipped`
    );

    return NextResponse.json({
      checked: contracts.length,
      reminderDate: reminderDateStr,
      processed: dueContracts.length,
      sent,
      errors,
      skipped,
      results,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { cron: "subscription-reminder" },
    });
    console.error("[Subscription Reminder] Fatal error:", error);
    return NextResponse.json(
      { error: "Subscription reminder cron failed" },
      { status: 500 }
    );
  }
}
