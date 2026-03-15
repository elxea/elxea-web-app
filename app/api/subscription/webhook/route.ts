import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import crypto from "crypto";
import {
  addMembershipTag,
  removeMembershipTags,
} from "@/lib/shopify/subscription-admin";
import { sendLineNotify } from "@/lib/line/notify";

const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || "";

type WebhookTopic =
  | "SUBSCRIPTION_CONTRACTS_CREATE"
  | "SUBSCRIPTION_CONTRACTS_UPDATE"
  | "SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS"
  | "SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE"
  | "SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED";

/**
 * Verify Shopify webhook HMAC-SHA256 signature.
 * Returns true if the request is authentic.
 */
function verifyWebhookSignature(
  body: string,
  hmacHeader: string | null
): boolean {
  if (!SHOPIFY_WEBHOOK_SECRET || !hmacHeader) {
    return false;
  }

  const digest = crypto
    .createHmac("sha256", SHOPIFY_WEBHOOK_SECRET)
    .update(body, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(digest),
    Buffer.from(hmacHeader)
  );
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic") as WebhookTopic | null;
  const shopDomain = request.headers.get("x-shopify-shop-domain");

  // Verify signature
  if (!verifyWebhookSignature(body, hmac)) {
    console.error("[Subscription Webhook] Invalid HMAC signature", {
      topic,
      shopDomain,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    console.error("[Subscription Webhook] Invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Handle each topic
  try {
    switch (topic) {
      case "SUBSCRIPTION_CONTRACTS_CREATE":
        await handleContractCreate(payload);
        break;

      case "SUBSCRIPTION_CONTRACTS_UPDATE":
        await handleContractUpdate(payload);
        break;

      case "SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS":
        await handleBillingSuccess(payload);
        break;

      case "SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE":
        handleBillingFailure(payload);
        break;

      case "SUBSCRIPTION_BILLING_ATTEMPTS_CHALLENGED":
        handleBillingChallenged(payload);
        break;

      default:
        console.warn("[Subscription Webhook] Unknown topic:", topic);
    }
  } catch (error) {
    // Log to Sentry but still return 200 to prevent Shopify retries
    Sentry.captureException(error, {
      tags: {
        webhook_topic: topic ?? "unknown",
        shop_domain: shopDomain ?? "unknown",
      },
      extra: { payload },
    });
    console.error("[Subscription Webhook] Handler error:", error);
  }

  // Return 200 quickly to acknowledge receipt
  return NextResponse.json({ received: true });
}

// ─── Topic handlers ──────────────────────────────────────────────────

async function handleContractCreate(payload: Record<string, unknown>) {
  const contractId = payload.admin_graphql_api_id as string | undefined;
  const customerId = payload.customer_id as number | undefined;
  const status = payload.status as string | undefined;

  console.log("[Subscription Webhook] Contract created:", {
    contractId,
    status,
    customerId,
  });

  // Auto-tag customer as member when a subscription is created and active
  if (customerId && status === "active") {
    try {
      const customerGid = `gid://shopify/Customer/${customerId}`;
      await addMembershipTag(customerGid, "standard");
      console.log("[Subscription Webhook] Tagged customer:", customerGid);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { webhook: "contract_create_tagging" },
        extra: { customerId, contractId },
      });
    }
  }
}

async function handleContractUpdate(payload: Record<string, unknown>) {
  const contractId = payload.admin_graphql_api_id as string | undefined;
  const customerId = payload.customer_id as number | undefined;
  const status = payload.status as string | undefined;

  console.log("[Subscription Webhook] Contract updated:", {
    contractId,
    status,
    updatedAt: payload.updated_at,
  });

  // Manage membership tags based on contract status
  if (customerId) {
    const customerGid = `gid://shopify/Customer/${customerId}`;
    try {
      if (status === "active") {
        await addMembershipTag(customerGid, "standard");
        console.log("[Subscription Webhook] Re-tagged active member:", customerGid);
      } else if (status === "cancelled" || status === "expired") {
        await removeMembershipTags(customerGid);
        console.log("[Subscription Webhook] Removed membership tags:", customerGid);
      }
      // "paused" keeps the tags — member benefits continue while paused
    } catch (error) {
      Sentry.captureException(error, {
        tags: { webhook: "contract_update_tagging" },
        extra: { customerId, contractId, status },
      });
    }
  }
}

async function handleBillingSuccess(payload: Record<string, unknown>) {
  const contractId =
    (payload.subscription_contract as Record<string, unknown> | undefined)
      ?.admin_graphql_api_id ?? payload.admin_graphql_api_id;
  const customerId = payload.customer_id as number | undefined;

  console.log("[Subscription Webhook] Billing succeeded:", {
    contractId,
    orderId: payload.order_id,
  });

  // Ensure membership tag is present after successful billing
  if (customerId) {
    try {
      const customerGid = `gid://shopify/Customer/${customerId}`;
      await addMembershipTag(customerGid, "standard");
    } catch (error) {
      Sentry.captureException(error, {
        tags: { webhook: "billing_success_tagging" },
        extra: { customerId, contractId },
      });
    }
  }
}

function handleBillingFailure(payload: Record<string, unknown>) {
  const contractId =
    (payload.subscription_contract as Record<string, unknown> | undefined)
      ?.admin_graphql_api_id ?? payload.admin_graphql_api_id;

  const errorMessage = payload.error_message as string | undefined;
  const errorCode = payload.error_code as string | undefined;

  console.error("[Subscription Webhook] Billing failed:", {
    contractId,
    errorMessage,
    errorCode,
  });

  // Alert via Sentry for failed charges
  Sentry.captureMessage("Subscription billing attempt failed", {
    level: "warning",
    tags: {
      error_code: errorCode ?? "unknown",
    },
    extra: {
      contractId,
      errorMessage,
      errorCode,
    },
  });

  // Alert via LINE push notification
  void sendLineNotify({
    subject: "サブスク決済失敗",
    body: `契約ID: ${contractId ?? "不明"}\nエラー: ${errorMessage ?? "不明"}\nコード: ${errorCode ?? "不明"}`,
    level: "error",
  });

  // Future: notify customer, schedule retry, update dunning status
}

function handleBillingChallenged(payload: Record<string, unknown>) {
  const contractId =
    (payload.subscription_contract as Record<string, unknown> | undefined)
      ?.admin_graphql_api_id ?? payload.admin_graphql_api_id;

  console.log("[Subscription Webhook] Billing challenged (3D Secure):", {
    contractId,
    nextActionUrl: payload.next_action_url,
  });

  Sentry.captureMessage("Subscription billing attempt challenged (3DS)", {
    level: "info",
    extra: {
      contractId,
      nextActionUrl: payload.next_action_url,
    },
  });

  // Alert via LINE push notification for 3DS challenge
  void sendLineNotify({
    subject: "サブスク 3D セキュア認証待ち",
    body: `契約ID: ${contractId ?? "不明"}\n顧客が 3D セキュア認証を完了する必要があります。`,
    level: "warning",
  });

  // Future: notify customer to complete 3D Secure authentication
}
