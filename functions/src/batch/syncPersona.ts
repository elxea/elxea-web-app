/**
 * 日次バッチ: Firestore persona/tier → Shopify Customer Metafield 同期
 *
 * スケジュール: 毎日 AM 4:00 JST（PM 7:00 UTC）
 *
 * フロー:
 *   1. Firestore users/ コレクションを全件スキャン（persona が更新済みのもの）
 *   2. 各ユーザーの persona.primary と membershipTier を Shopify Customer Metafield に書き込む
 *   3. Metafield namespace: "elxea_crm", key: "persona" / "membership_tier"
 *
 * 環境変数（Firebase Functions Config または Secret Manager）:
 *   SHOPIFY_STORE_DOMAIN      — ストアドメイン（例: elxea.myshopify.com）
 *   SHOPIFY_ADMIN_ACCESS_TOKEN — Admin API Access Token
 *
 * 注意: Customer ID は Firestore document ID（= Shopify Customer 数値 ID）
 */

import * as functions from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Shopify Metafield 更新
// ---------------------------------------------------------------------------

const SHOPIFY_API_VERSION = "2025-01";
const METAFIELD_NAMESPACE = "elxea_crm";

/**
 * Shopify GraphQL Admin API を呼び出す。
 */
async function shopifyGraphQL(
  query: string,
  variables: Record<string, unknown>,
  storeDomain: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!res.ok) {
    throw new Error(`Shopify API error: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    data?: Record<string, unknown>;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(
      `Shopify GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }

  return json.data ?? {};
}

/**
 * Shopify Customer Metafield を upsert する。
 *
 * metafieldsSet mutation を使用して persona と membershipTier を設定する。
 */
async function upsertCustomerMetafields(
  shopifyCustomerId: string,
  persona: string | null,
  membershipTier: string | null,
  storeDomain: string,
  accessToken: string,
): Promise<void> {
  const metafields: Array<{
    ownerId: string;
    namespace: string;
    key: string;
    value: string;
    type: string;
  }> = [];

  const gid = `gid://shopify/Customer/${shopifyCustomerId}`;

  if (persona) {
    metafields.push({
      ownerId: gid,
      namespace: METAFIELD_NAMESPACE,
      key: "persona",
      value: persona,
      type: "single_line_text_field",
    });
  }

  if (membershipTier) {
    metafields.push({
      ownerId: gid,
      namespace: METAFIELD_NAMESPACE,
      key: "membership_tier",
      value: membershipTier,
      type: "single_line_text_field",
    });
  }

  if (metafields.length === 0) return;

  const mutation = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
          code
        }
      }
    }
  `;

  const result = await shopifyGraphQL(
    mutation,
    { metafields },
    storeDomain,
    accessToken,
  );

  const userErrors = (
    result.metafieldsSet as {
      userErrors: Array<{ field: string[]; message: string }>;
    }
  )?.userErrors;

  if (userErrors?.length) {
    throw new Error(
      `Metafield upsert errors for customer ${shopifyCustomerId}: ${userErrors.map((e) => `${e.field.join(".")}: ${e.message}`).join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cloud Function 本体
// ---------------------------------------------------------------------------

export const syncPersonaToShopify = functions.onSchedule(
  {
    schedule: "0 19 * * *", // 毎日 PM 7:00 UTC = AM 4:00 JST
    timeZone: "UTC",
    region: "asia-northeast1",
    timeoutSeconds: 540, // 9分（全ユーザーのバッチ処理）
    memory: "512MiB",
    secrets: ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN"],
  },
  async (_event) => {
    const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

    if (!storeDomain || !accessToken) {
      logger.error("Missing Shopify credentials");
      return;
    }

    logger.info("Starting persona sync to Shopify");

    // Firestore users/ をページネーションで全件スキャン
    // persona が設定されているドキュメントのみ対象
    const BATCH_SIZE = 50;
    let lastDoc: admin.firestore.DocumentSnapshot | null = null;
    let total = 0;
    let succeeded = 0;
    let failed = 0;

    while (true) {
      let query = db
        .collection("users")
        .where("persona.primary", "!=", null)
        .limit(BATCH_SIZE);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) break;

      // バッチ内を並列処理
      const results = await Promise.allSettled(
        snapshot.docs.map(async (doc) => {
          const data = doc.data();
          const persona = (data.persona?.primary as string | null) ?? null;
          const membershipTier =
            (data.membershipTier as string | null) ?? null;

          await upsertCustomerMetafields(
            doc.id,
            persona,
            membershipTier,
            storeDomain,
            accessToken,
          );
        }),
      );

      results.forEach((result, i) => {
        total++;
        if (result.status === "fulfilled") {
          succeeded++;
        } else {
          failed++;
          logger.error("Failed to sync customer", {
            customerId: snapshot.docs[i].id,
            error: result.reason,
          });
        }
      });

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      if (snapshot.docs.length < BATCH_SIZE) break;
    }

    logger.info("Persona sync completed", { total, succeeded, failed });
  },
);
