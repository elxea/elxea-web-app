import { NextRequest, NextResponse } from "next/server";
import { validateWebhookRequest } from "@/lib/shopify/webhooks/verify";
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
 * Collect all documents from a Firestore subcollection.
 */
async function collectSubcollection(
  db: FirebaseFirestore.Firestore,
  collectionPath: string,
): Promise<Record<string, unknown>[]> {
  const snapshot = await db.collection(collectionPath).get();
  return snapshot.docs.map((doc) => ({ _id: doc.id, ...doc.data() }));
}

/**
 * Shopify GDPR: customers/data_request webhook handler.
 *
 * Shopify sends this when a customer requests their data.
 * elxea stores customer data in Firestore, so we export the user document
 * and all subcollections, then log the export. In a production system
 * this data would be sent to the customer or a secure endpoint; for now
 * we log it and return 200.
 */
export async function POST(request: NextRequest) {
  const validation = await validateWebhookRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { payload, topic } = validation;
  const body = payload as {
    customer?: { id?: number; email?: string };
    shop_domain?: string;
    data_request?: { id?: number };
  };

  console.log(
    `[Webhook:GDPR] Received ${topic}: customers/data_request (customerId=${body.customer?.id ?? "unknown"}, requestId=${body.data_request?.id ?? "unknown"})`,
  );

  const shopifyCustomerId = body.customer?.id;
  if (!shopifyCustomerId) {
    console.warn(
      "[Webhook:GDPR] customers/data_request: no customer.id in payload",
    );
    return NextResponse.json({ received: true });
  }

  const customerId = String(shopifyCustomerId);

  try {
    const db = getAdminFirestore();

    // Collect the user profile document
    const userSnapshot = await db.doc(userDoc(customerId)).get();
    const userProfile = userSnapshot.exists ? userSnapshot.data() : null;

    // Collect all subcollections in parallel
    const [orders, behaviorLog, favorites, follows, eventRegistrations, conversations] =
      await Promise.all([
        collectSubcollection(db, ordersCol(customerId)),
        collectSubcollection(db, behaviorLogCol(customerId)),
        collectSubcollection(db, favoritesCol(customerId)),
        collectSubcollection(db, followsCol(customerId)),
        collectSubcollection(db, eventRegistrationsCol(customerId)),
        collectSubcollection(db, conversationsCol(customerId)),
      ]);

    // Do NOT log the exportedData payload — it contains PII.
    // In production, the exported data should be encrypted and sent to a secure
    // endpoint (e.g. signed S3 URL, Shopify notification) or stored for customer
    // retrieval. For now, log only counts for auditability.
    const counts = {
      customerId,
      requestId: body.data_request?.id,
      exportedAt: new Date().toISOString(),
      hasUserProfile: userProfile != null,
      orders: orders.length,
      behaviorLog: behaviorLog.length,
      favorites: favorites.length,
      follows: follows.length,
      eventRegistrations: eventRegistrations.length,
      conversations: conversations.length,
    };
    console.log(
      `[Webhook:GDPR] Exported data counts for customer ${customerId}:`,
      JSON.stringify(counts),
    );

    // TODO: when SHOPIFY_GDPR_EXPORT_ENDPOINT is configured, forward the full
    // (encrypted) exported data to that endpoint. Until then, only counts are
    // persisted to logs and the actual payload is discarded.
  } catch (error) {
    /* 開示請求は法令上の義務。ここで落ちても Shopify には 200 を返す作りなので、
       黙ると**請求に応えていないことが誰にも分からない**。載せるのは顧客 ID と
       請求 ID とストアだけで、書き出した中身 (個人情報) は載せない。 */
    logger.error("api.gdpr-customers-data-request.export-failed", error, {
      customerId,
      requestId: body.data_request?.id,
      shopDomain: body.shop_domain,
    });
  }

  return NextResponse.json({ received: true });
}
