import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  validateWebhookRequest,
  checkWebhookIdempotency,
} from "@/lib/shopify/webhooks/verify";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { advanceNextBillingDate } from "@/lib/shopify/next-billing-date";

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
 *
 * ## なぜ success で `nextBillingDate` を前進させるのか (2026-08-12)
 *
 * `nextBillingDate` はアプリが管理するフィールドで、`subscriptionBillingAttemptCreate`
 * はこれに触らない (前進はアプリの責務)。cron 側 (`app/api/cron/billing`) は課金が
 * **確定成功した枝でだけ**前進させるが、Shopify の課金は非同期なので `ready: false` の
 * `pending` で抜けることがある。その場合 cron は前進しないまま終わり、確定結果は
 * この webhook にしか来ない — **`pending` 経路を拾える唯一の場所がここ**。
 *
 * 二重前進の心配は無い。前進は「UNBILLED かつ skipped でない最小 cycle の
 * `billingAttemptExpectedDate`」の導出で、日付の算術をしないため何回呼んでも同じ値に
 * 収束する (`lib/shopify/next-billing-date.ts`)。webhook の再送は
 * `checkWebhookIdempotency` が先に落とすが、それを取りこぼしても導出型なので
 * 自然に `noop` になる (二層の安全網)。
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

/**
 * webhook payload の数値 contract id を Admin API の GID に組み立てる。
 *
 * 形を検証してから返す。数値でない / 負値のような値をそのまま GID に埋めて
 * mutation に渡すと、別リソースを指す文字列を Shopify に投げることになる。
 */
function toSubscriptionContractGid(contractId: unknown): string | null {
  if (typeof contractId !== "number" || !Number.isInteger(contractId)) return null;
  if (contractId <= 0) return null;
  return `gid://shopify/SubscriptionContract/${contractId}`;
}

async function handleBillingSuccess(
  payload: BillingAttemptPayload,
): Promise<void> {
  console.log(
    `[Webhook:subscription] Billing success: attempt=${payload.id}, contract=${payload.subscription_contract_id}`,
  );

  // ガード 2 をこちら側でも明示する: 課金が確定成功したときだけ前進させる。
  // topic が success なので通常 `error_code` は無いが、topic 名だけを根拠に請求日を
  // 進める作りにはしない (失敗した周期を飛ばして未収を作るのが最悪の壊れ方なので、
  // payload 自身が失敗を示しているなら topic より payload を信じる)。
  if (payload.error_code) {
    console.warn(
      `[Webhook:subscription] Success topic carried an error_code (${payload.error_code}); nextBillingDate not advanced (attempt=${payload.id})`,
    );
    return;
  }

  const contractGid = toSubscriptionContractGid(payload.subscription_contract_id);

  if (contractGid === null) {
    // 前進できないことを黙って落とさない。ここを無音にすると「課金は成功したのに
    // 次回請求日が動かない」= 2026-08 の停止と同じ形になる。
    console.error(
      `[Webhook:subscription] Cannot advance nextBillingDate: unusable contract id (attempt=${payload.id})`,
    );
    Sentry.captureMessage(
      "nextBillingDate advance skipped: unusable subscription_contract_id",
      {
        level: "error",
        tags: { webhook: "subscription", event: "billing_success" },
        extra: {
          attemptId: payload.id,
          contractIdType: typeof payload.subscription_contract_id,
        },
      },
    );
    return;
  }

  // 例外は投げない (`failed` に畳んで返る) が、失敗は必ず Sentry と console に出る
  // — lib 側が申告を担保している。ここで throw させないのは、前進の失敗で 500 を
  // 返すと Shopify が同じ課金成功イベントを再送し続けることになるため。前進が
  // 失敗した契約は cron の Case 1 (既に課金済み) が翌日以降に拾い直す。
  const result = await advanceNextBillingDate(contractGid);

  console.log(
    `[Webhook:subscription] nextBillingDate ${result.action} for contract=${payload.subscription_contract_id} (${result.from} -> ${result.to})`,
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

/**
 * handler は同期・非同期の両方を許す。`billing_attempts/success` は
 * `nextBillingDate` の前進 (Admin API 呼び出し) を伴うため await が必要で、
 * ここが `=> void` 固定だと戻り値の Promise が捨てられ、**前進が完了する前に
 * `markProcessed()` が走って 200 を返す** (失敗しても誰も気づけない上、
 * idempotency で二度目も来ない)。
 */
type TopicHandler = (payload: never) => void | Promise<void>;

const TOPIC_HANDLERS: Record<string, TopicHandler> = {
  "subscription_contracts/create": handleContractCreate as TopicHandler,
  "subscription_contracts/update": handleContractUpdate as TopicHandler,
  "subscription_billing_attempts/success": handleBillingSuccess as TopicHandler,
  "subscription_billing_attempts/failure": handleBillingFailure as TopicHandler,
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
      // await を落とすと非同期 handler (billing success の前進) の完了前に
      // markProcessed が走る。上の TopicHandler のコメント参照。
      await handler(payload as never);
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
