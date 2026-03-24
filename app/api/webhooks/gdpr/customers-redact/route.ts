import { NextRequest, NextResponse } from "next/server";
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
import { extractCustomerId } from "@/lib/firebase/types";

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
    `[Webhook:GDPR] Received ${topic}: customers/redact`,
    JSON.stringify(payload),
  );

  const shopifyCustomerId = body.customer?.id;
  if (!shopifyCustomerId) {
    console.warn("[Webhook:GDPR] customers/redact: no customer.id in payload");
    return NextResponse.json({ received: true });
  }

  const customerId = String(shopifyCustomerId);

  try {
    const db = getAdminFirestore();

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
      }
    }

    // Delete the user document itself
    await db.doc(userDoc(customerId)).delete();
    console.log(`[Webhook:GDPR] Deleted user document: ${userDoc(customerId)}`);
  } catch (error) {
    console.error("[Webhook:GDPR] Error deleting customer data:", error);
    // Return 200 to acknowledge receipt — Shopify will retry on non-200
    // and we don't want infinite retries for transient errors.
  }

  return NextResponse.json({ received: true });
}
