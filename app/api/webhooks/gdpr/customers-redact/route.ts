import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { FieldValue } from "firebase-admin/firestore";
import { validateWebhookRequest } from "@/lib/shopify/webhooks/verify";
import { eraseInCxAgent } from "@/lib/erase/cx-agent";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/log";
import {
  userDoc,
  ordersCol,
  behaviorLogCol,
  favoritesCol,
  followsCol,
  eventRegistrationsCol,
  conversationsCol,
} from "@/lib/firebase/collections";

/**
 * Delete all documents in a Firestore subcollection.
 * Firestore does not support deleting subcollections atomically, so we
 * fetch all docs and delete them in batches.
 */
async function deleteSubcollection(
  db: FirebaseFirestore.Firestore,
  collectionPath: string,
): Promise<number> {
  const snapshot = await db.collection(collectionPath).get();
  if (snapshot.empty) return 0;

  const batch = db.batch();
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
  }
  await batch.commit();
  return snapshot.size;
}

/**
 * Shopify GDPR: customers/redact webhook handler.
 *
 * Shopify sends this when a customer requests deletion of their data.
 * elxea stores customer data in Firestore under users/{customerId},
 * including subcollections for orders, behaviorLog, favorites, follows,
 * eventRegistrations, and conversations. All must be deleted.
 *
 * ## 消える範囲は Firestore だけではない（M-5 / Issue A・2026-08-25）
 *
 * 本人のデータは 2 か所にある。Firestore（web-app の持ち物）と、Supabase の連携台帳・
 * 会話履歴・カルテ（cx-agent の持ち物）である。後者は **cx-agent の worker からしか
 * 触れない**ので、cx-agent 側に `POST /api/erase` が用意され、コードにもこう書いてある —
 * 「web-app 側の `customers/redact` はここを呼ぶだけにして、『何が消える範囲か』の定義を
 * 1 か所に集約する」。
 *
 * **その呼び出しが一度も書かれていなかった。** 結果、削除要求に対して Firestore だけを
 * 消して 200 を返し、Supabase 側は丸ごと残ったまま「消しました」と答えていた。
 *
 * ## 順番 — cx-agent を先に呼ぶ
 *
 * Firestore を先に消すと、cx-agent 側が落ちたときに **Firestore だけ消えた中途半端な状態**が
 * 残り、しかも再送で cx-agent が消えても Firestore の消去は既に済んでいるので、
 * 「どこまで消えたか」が経路から読めなくなる。cx-agent を先に通しておけば、失敗した
 * 時点では**何も消えていない**か、**cx-agent 側だけ消えている**かのどちらかで、
 * どちらも再送で前に進む（両側とも冪等）。
 *
 * ## 消えなかったら 200 を返さない
 *
 * G10（成功偽装をしない）。cx-agent が消し残しを検出したら 5xx を返し、Shopify に
 * 再送させる。冪等なので再送で害は無く、放置すると GDPR 上の実害だけが残る。
 * 例外は「鍵が無い / 鍵が違う」— これは再送しても直らないので、鳴らしたうえで
 * 再送を促さない（詳細は `lib/erase/cx-agent.ts` の `retryable`）。
 */
export async function POST(request: NextRequest) {
  const validation = await validateWebhookRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { payload, topic } = validation;
  const body = payload as {
    customer?: { id?: number };
    shop_domain?: string;
  };

  console.log(
    `[Webhook:GDPR] Received ${topic}: customers/redact (customerId=${body.customer?.id ?? "unknown"})`,
  );

  const shopifyCustomerId = body.customer?.id;
  if (!shopifyCustomerId) {
    console.warn("[Webhook:GDPR] customers/redact: no customer.id in payload");
    return NextResponse.json({ received: true });
  }

  const customerId = String(shopifyCustomerId);
  const webhookId = request.headers.get("x-shopify-webhook-id");

  try {
    const db = getAdminFirestore();

    // Idempotency: if we have a webhook id, check whether this delivery has
    // already been processed. Shopify may retry GDPR redact webhooks on 5xx
    // or network errors, and we must not double-delete or race with another
    // delivery.
    if (webhookId) {
      const logRef = db.collection("_webhookLogs").doc(webhookId);
      const existing = await logRef.get();
      if (existing.exists) {
        console.log(
          `[Webhook:GDPR] customers/redact already processed (webhookId=${webhookId}), returning 200`,
        );
        return NextResponse.json({ received: true, idempotent: true });
      }
    } else {
      console.warn(
        "[Webhook:GDPR] customers/redact missing x-shopify-webhook-id header; idempotency not enforced",
      );
    }

    /* cx-agent 側（Supabase の台帳・会話履歴・カルテ）を先に消す。順番の理由は
       ファイル冒頭の注記のとおり。202 が返る間は消しきるまで呼び直す —
       202 は 2xx だが**完了ではない**。 */
    const cxErase = await eraseInCxAgent({ kind: "shopify", id: customerId });
    if (!cxErase.ok) {
      /* ⚠ 顧客 ID はログに載せない（削除要求の対象を痕跡として残さないため）。
         切り分けに要るのは reason と試行回数だけで、それで足りる。 */
      console.error(
        `[Webhook:GDPR] customers/redact aborted — cx-agent erase failed (reason=${cxErase.reason}, attempts=${cxErase.attempts}): ${cxErase.detail}`,
      );
      Sentry.captureMessage("GDPR redact: cx-agent erase failed", {
        level: "error",
        tags: {
          subsystem: "gdpr-redact",
          reason: cxErase.reason,
          retryable: String(cxErase.retryable),
        },
        extra: { attempts: cxErase.attempts, detail: cxErase.detail },
      });

      /* 冪等ログは**書かない**。書くと再送が「処理済み」で弾かれ、消えていない
         まま二度と消えなくなる。 */
      return NextResponse.json(
        { error: "cx-agent erase failed", reason: cxErase.reason },
        { status: cxErase.retryable ? 503 : 500 },
      );
    }
    console.log(
      `[Webhook:GDPR] cx-agent erase completed (attempts=${cxErase.attempts})`,
    );

    // Delete all subcollections in parallel
    const subcollections = [
      ordersCol(customerId),
      behaviorLogCol(customerId),
      favoritesCol(customerId),
      followsCol(customerId),
      eventRegistrationsCol(customerId),
      conversationsCol(customerId),
    ];

    const results = await Promise.allSettled(
      subcollections.map((col) => deleteSubcollection(db, col)),
    );

    // Track any subcollection deletion failures. We must NOT return 200 if
    // any deletion failed — that would silently drop a GDPR request and
    // leave orphan customer data.
    const failedSubcollections: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        console.log(
          `[Webhook:GDPR] Deleted ${result.value} docs from ${subcollections[i]}`,
        );
      } else {
        console.error(
          `[Webhook:GDPR] Failed to delete ${subcollections[i]}:`,
          result.reason,
        );
        failedSubcollections.push(subcollections[i]!);
      }
    }

    if (failedSubcollections.length > 0) {
      // Return 500 so Shopify retries. We intentionally do NOT write the
      // idempotency log doc, so the retry will re-enter the try block.
      console.error(
        `[Webhook:GDPR] Aborting — subcollection deletion failures:`,
        failedSubcollections,
      );
      return NextResponse.json(
        { error: "Partial deletion failure" },
        { status: 500 },
      );
    }

    // Delete the user document itself. Failure here must also surface as 5xx
    // so Shopify retries and the customer's root user doc is not orphaned.
    try {
      await db.doc(userDoc(customerId)).delete();
      console.log(
        `[Webhook:GDPR] Deleted user document: ${userDoc(customerId)}`,
      );
    } catch (userDocErr) {
      /* 子は消えたのに本人の文書だけ残る = 消し残り。法令上の義務なので、
         Shopify の再送に任せきりにせず人が気づける側にも載せる。 */
      logger.error("api.gdpr-customers-redact.user-doc-delete-failed", userDocErr, {
        customerId,
        shopDomain: body.shop_domain,
        status: 500,
      });
      return NextResponse.json(
        { error: "User document deletion failed" },
        { status: 500 },
      );
    }

    // Record successful processing for idempotency. Only reached when all
    // deletions succeeded.
    if (webhookId) {
      const { Timestamp } = await import("firebase-admin/firestore");
      await db.collection("_webhookLogs").doc(webhookId).set({
        topic,
        source: "shopify",
        kind: "customers/redact",
        customerId,
        processedAt: FieldValue.serverTimestamp(),
        // TTL: 7 days. Dedup log is GC'd by Firestore TTL policy.
        ttl: Timestamp.fromDate(
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ),
      });
    }
  } catch (error) {
    /* Unhandled error — return 500 so Shopify retries. Previous behavior
       returned 200 which silently dropped GDPR requests.
       再送は Shopify 任せなので、再送も尽きたまま消えていない状態に
       誰も気づけない事態を避けるため、ここは必ず鳴らす。
       webhook の本文は個人情報なので載せない。 */
    logger.error("api.gdpr-customers-redact.erase-failed", error, {
      customerId,
      shopDomain: body.shop_domain,
      status: 500,
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
