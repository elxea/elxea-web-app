import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getSubscriptionContracts } from "@/lib/shopify/subscription-admin";
import { sendSubscriptionReminder } from "@/lib/email/subscription-reminder";
import {
  claimReminderSend,
  recordReminderOutcome,
} from "@/lib/email/reminder-send-log";

/**
 * Cron-triggered subscription renewal reminder.
 * Finds ACTIVE subscription contracts with nextBillingDate within the
 * reminder window (default: 3 days ahead) and sends reminder emails.
 *
 * Expected to be called daily by Vercel Cron (vercel.json).
 * Protected by CRON_SECRET header check.
 *
 * 2026-08-11 の失敗系監査で塞いだ 2 点:
 *
 *   1. **二重送信** — 対象日の一致だけで拾っていたため、cron が同日に二重発火すると
 *      同じ顧客へ 2 通届いた。送信前に「契約 x 対象日」の予約を取り
 *      (`lib/email/reminder-send-log.ts`)、取れたときだけ送る。
 *   2. **沈黙** — `sendSubscriptionReminder` は Resend のエラー応答を例外ではなく
 *      `{ success: false }` で返すため、throw 経路にしか無かった Sentry には
 *      一切乗らなかった。エラー応答も監視に上げる。
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
    status: "sent" | "skipped" | "duplicate" | "error";
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

      // 送る前に「契約 x 対象日」の予約を取る。取れなければ送らない
      // (同日の二重発火で顧客に 2 通届くのを防ぐ)。
      const claim = await claimReminderSend(contract.id, reminderDateStr);

      if (!claim.claimed) {
        if (claim.reason === "duplicate") {
          // 正常系: この対象日はもう送っている。異常ではないので Sentry には上げない。
          results.push({
            contractId: contract.id,
            customerEmail,
            status: "duplicate",
            detail: "Already sent for this reminder date",
          });
          continue;
        }

        // 予約自体が取れなかった (Firestore 障害など)。送らずに監視へ上げる —
        // 予約なしで送ると二重送信を防げなくなる。
        console.error(
          `[Subscription Reminder] 送信予約が取れないため送信しません (${contract.id}): ${claim.detail}`
        );
        Sentry.captureMessage("[Subscription Reminder] claim failed", {
          level: "error",
          tags: { cron: "subscription-reminder", phase: "claim" },
          extra: {
            contractId: contract.id,
            reminderDate: reminderDateStr,
            detail: claim.detail,
          },
        });
        results.push({
          contractId: contract.id,
          customerEmail,
          status: "error",
          detail: `Reminder claim failed: ${claim.detail}`,
        });
        continue;
      }

      try {
        const result = await sendSubscriptionReminder({
          customerEmail,
          customerName,
          nextBillingDate: contract.nextBillingDate!,
          items,
          deliveryInterval,
        });

        // Resend のエラー応答は例外にならない。ここで監視に上げないと不着が沈黙する。
        if (!result.success) {
          console.error(
            `[Subscription Reminder] 送信に失敗しました (${contract.id}): ${result.error}`
          );
          Sentry.captureMessage("[Subscription Reminder] email not sent", {
            level: "error",
            tags: { cron: "subscription-reminder", phase: "send" },
            extra: {
              contractId: contract.id,
              reminderDate: reminderDateStr,
              reason: result.error,
            },
          });
        }

        await recordReminderOutcome(claim.docId, {
          sent: result.success,
          error: result.error,
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
        await recordReminderOutcome(claim.docId, {
          sent: false,
          error: message,
        });
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
    const duplicates = results.filter((r) => r.status === "duplicate").length;

    console.log(
      `[Subscription Reminder] Processed ${dueContracts.length} contracts: ${sent} sent, ${errors} errors, ${skipped} skipped, ${duplicates} duplicates`
    );

    return NextResponse.json({
      checked: contracts.length,
      reminderDate: reminderDateStr,
      processed: dueContracts.length,
      sent,
      errors,
      skipped,
      duplicates,
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
