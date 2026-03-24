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
    `[Webhook:GDPR] Received ${topic}: customers/data_request`,
    JSON.stringify(payload),
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

    const exportedData = {
      customerId,
      requestId: body.data_request?.id,
      exportedAt: new Date().toISOString(),
      userProfile,
      orders,
      behaviorLog,
      favorites,
      follows,
      eventRegistrations,
      conversations,
    };

    // Log the exported data. In production, this should be sent to a secure
    // endpoint or stored for customer retrieval.
    console.log(
      `[Webhook:GDPR] Exported data for customer ${customerId}:`,
      JSON.stringify(exportedData),
    );
  } catch (error) {
    console.error("[Webhook:GDPR] Error exporting customer data:", error);
  }

  return NextResponse.json({ received: true });
}
