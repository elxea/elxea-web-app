import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  validateWebhookRequest,
  checkWebhookIdempotency,
} from "@/lib/shopify/webhooks/verify";
import { getAdminFirestore } from "@/lib/firebase/admin";

/**
 * Shopify Subscription Webhook handler.
 *
 * Handles the following topics:
 *   - SUBSCRIPTION_CONTRACTS_CREATE
 *   - SUBSCRIPTION_CONTRACTS_UPDATE
 *   - SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS
 *   - SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE
 *
 * The webhook URL is already registered in Shopify at
 * `elxea.com/api/subscription/webhook`. This route provides the
 * corresponding handler.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubscriptionContractPayload {
  admin_graphql_api_id: string;
  id: number;
  billing_policy: {
    interval: string;
    interval_count: number;
    min_cycles: number | null;
    max_cycles: number | null;
  };
  delivery_policy: {
    interval: string;
    interval_count: number;
  };
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface BillingAttemptPayload {
  admin_graphql_api_id: string;
  id: number;
  subscription_contract_id: number;
  ready: boolean;
  error_message: string | null;
  error_code: string | null;
  created_at: string;
}

/**
 * Extract only non-PII identifiers from an unknown webhook payload for logging.
 * Never include email, name, address, or other PII.
 */
function extractSafePayloadIds(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return { payloadType: typeof payload };
  }
  const p = payload as Record<string, unknown>;
  const customer = (p.customer ?? null) as { id?: number } | null;
  return {
    id: p.id,
    subscriptionContractId: p.subscription_contract_id,
    customerId: customer?.id,
    status: p.status,
    createdAt: p.created_at,
  };
}

// ---------------------------------------------------------------------------
// Topic handlers
// ---------------------------------------------------------------------------

function handleContractCreate(payload: SubscriptionContractPayload): void {
  console.log(
    `[Webhook:subscription] Contract created: id=${payload.id}, status=${payload.status}, customer=${payload.customer?.id ?? "unknown"}`,
  );
}

function handleContractUpdate(payload: SubscriptionContractPayload): void {
  console.log(
    `[Webhook:subscription] Contract updated: id=${payload.id}, status=${payload.status}, customer=${payload.customer?.id ?? "unknown"}`,
  );

  // Track cancellations and pauses for observability
  if (payload.status === "CANCELLED" || payload.status === "PAUSED") {
    Sentry.captureMessage(
      `Subscription contract ${payload.status.toLowerCase()}: ${payload.id}`,
      {
        level: "warning",
        tags: { webhook: "subscription", event: payload.status.toLowerCase() },
        extra: {
          contractId: payload.id,
          customerId: payload.customer?.id,
          // PII (customerEmail) intentionally omitted — use Shopify Admin to correlate
        },
      },
    );
  }
}

function handleBillingSuccess(payload: BillingAttemptPayload): void {
  console.log(
    `[Webhook:subscription] Billing success: attempt=${payload.id}, contract=${payload.subscription_contract_id}`,
  );
}

function handleBillingFailure(payload: BillingAttemptPayload): void {
  console.warn(
    `[Webhook:subscription] Billing FAILURE: attempt=${payload.id}, contract=${payload.subscription_contract_id}, error=${payload.error_code}: ${payload.error_message}`,
  );

  // Dunning alert -- billing failure requires attention
  Sentry.captureMessage(
    `Subscription billing failed: contract=${payload.subscription_contract_id}, error=${payload.error_code}`,
    {
      level: "error",
      tags: {
        webhook: "subscription",
        event: "billing_failure",
        errorCode: payload.error_code ?? "unknown",
      },
      extra: {
        attemptId: payload.id,
        contractId: payload.subscription_contract_id,
        errorCode: payload.error_code,
        errorMessage: payload.error_message,
        ready: payload.ready,
        createdAt: payload.created_at,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Topic router
// ---------------------------------------------------------------------------

const TOPIC_HANDLERS: Record<
  string,
  (payload: never) => void
> = {
  "subscription_contracts/create": handleContractCreate as (p: never) => void,
  "subscription_contracts/update": handleContractUpdate as (p: never) => void,
  "subscription_billing_attempts/success": handleBillingSuccess as (
    p: never,
  ) => void,
  "subscription_billing_attempts/failure": handleBillingFailure as (
    p: never,
  ) => void,
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const validation = await validateWebhookRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { payload, topic, webhookId } = validation;

  console.log(`[Webhook:subscription] Received topic="${topic}"`);

  try {
    // Idempotency check: drop duplicate deliveries of the same event.
    const db = getAdminFirestore();
    const idem = await checkWebhookIdempotency(db, webhookId, topic);
    if (idem.alreadyProcessed) {
      return NextResponse.json({ received: true, topic, idempotent: true });
    }

    const handler = TOPIC_HANDLERS[topic];

    if (handler) {
      handler(payload as never);
    } else {
      console.warn(
        `[Webhook:subscription] Unhandled topic: ${topic}`,
      );
    }

    // Mark processed only after successful handling.
    await idem.markProcessed();

    // Always return 200 to prevent Shopify retries
    return NextResponse.json({ received: true, topic });
  } catch (error) {
    console.error(
      `[Webhook:subscription] Error processing topic="${topic}":`,
      error,
    );

    // Extract only non-PII identifiers from the payload for observability.
    const payloadIds = extractSafePayloadIds(payload);
    Sentry.captureException(error, {
      tags: { webhook: "subscription", topic },
      extra: payloadIds,
    });

    // Return 500 so Shopify retries
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
