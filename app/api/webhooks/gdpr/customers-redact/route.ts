import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { validateWebhookRequest } from "@/lib/shopify/webhooks/verify";
import { getAdminFirestore } from "@/lib/firebase/admin";
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
      console.error(
        `[Webhook:GDPR] Failed to delete user document ${userDoc(customerId)}:`,
        userDocErr,
      );
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
    // Unhandled error — return 500 so Shopify retries. Previous behavior
    // returned 200 which silently dropped GDPR requests.
    console.error("[Webhook:GDPR] Error deleting customer data:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
