import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/config";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { logger } from "@/lib/log";

/**
 * Cron-triggered cleanup of the _webhookLogs idempotency collection.
 *
 * Why this exists (not Firestore TTL):
 * The project runs on the Firebase Spark plan, which does not expose the
 * Firestore TTL admin API. Rather than upgrade to Blaze solely for this
 * cleanup, we emulate TTL by scanning and deleting expired entries on a
 * daily cron. The document schema still writes a `ttl` Timestamp field (see
 * lib/shopify/webhooks/verify.ts) so that when the project eventually moves
 * to Blaze, a native TTL policy can replace this route with zero changes.
 *
 * Retention: documents whose `ttl` field is in the past are deleted.
 * Writers currently set ttl = now + 7 days.
 *
 * Protected by CRON_SECRET header check (constant-time comparison).
 * Configured to run daily at 03:00 JST (18:00 UTC) via vercel.json.
 */

const CRON_SECRET = env("CRON_SECRET") ?? "";
const BATCH_SIZE = 400; // Firestore batch write limit is 500; leave headroom

function isAuthorizedCronRequest(authHeader: string | null): boolean {
  if (!CRON_SECRET || !authHeader) return false;
  const expected = `Bearer ${CRON_SECRET}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    /* 長さは手前で揃えてあるので、ここに来ること自体が想定外。黙って
       「不許可」にすると、掃除が止まっていることに誰も気付けない。 */
    logger.error("api.cron-webhook-logs-cleanup.secret-compare-failed", err, {
      route: "/api/cron/webhook-logs-cleanup",
      operation: "cron-secret-compare",
    });
    return false;
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!isAuthorizedCronRequest(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  let totalScanned = 0;
  let totalDeleted = 0;
  let batchCount = 0;

  try {
    const db = getAdminFirestore();
    const { Timestamp } = await import("firebase-admin/firestore");
    const now = Timestamp.now();

    // Loop until no more expired docs remain (or safety cap hit).
    // Each iteration queries and deletes up to BATCH_SIZE expired docs.
    // Safety cap prevents runaway loops if writes outpace deletes.
    const MAX_ITERATIONS = 50;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const snapshot = await db
        .collection("_webhookLogs")
        .where("ttl", "<", now)
        .limit(BATCH_SIZE)
        .get();

      if (snapshot.empty) break;

      totalScanned += snapshot.size;

      const batch = db.batch();
      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();

      totalDeleted += snapshot.size;
      batchCount++;

      if (snapshot.size < BATCH_SIZE) break;
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[Cron:WebhookLogsCleanup] Scanned ${totalScanned}, deleted ${totalDeleted} in ${batchCount} batches (${elapsedMs}ms)`,
    );

    return NextResponse.json({
      ok: true,
      scanned: totalScanned,
      deleted: totalDeleted,
      batches: batchCount,
      elapsedMs,
    });
  } catch (error) {
    console.error("[Cron:WebhookLogsCleanup] Error:", error);
    Sentry.captureException(error, {
      tags: { cron: "webhook-logs-cleanup" },
      extra: { totalScanned, totalDeleted, batchCount },
    });
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
