import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { sanityClient } from "@/sanity/lib/client";
import {
  sendFarmerNotification,
  type FarmerNotificationItem,
} from "@/lib/email/farmer-notification";
import { siteUrl } from "@/lib/site-url";
import { filterOutFictional } from "@/lib/fictional-content";

/**
 * Cron job: Notify followers of new articles/products from followed farmers.
 *
 * Schedule: Daily (see vercel.json)
 * Protection: CRON_SECRET header required
 *
 * Algorithm:
 *  1. Fetch all farmers from Sanity who have articles/products published
 *     within the past LOOKBACK_HOURS hours.
 *  2. For each such farmer, query Firestore for followers.
 *  3. Send one consolidated email per follower containing all new items.
 *
 * Notification deduplication: We track the last notification time per
 * (customerId, farmerSlug) pair in Firestore at
 * `notificationState/{customerId}/farmerNotifications/{farmerSlug}`.
 * This prevents re-sending if the cron runs multiple times for the same day.
 */

const CRON_SECRET = process.env.CRON_SECRET || "";
/** How far back to look for new content (hours) */
const LOOKBACK_HOURS = 25; // slightly over 24h to handle scheduling drift
const SITE_URL = siteUrl();

// ─── Sanity queries ───────────────────────────────────────────────────

type SanityFarmerWithContent = {
  farmerSlug: string;
  farmerName: string;
  newArticles: Array<{
    slug: string;
    title: string;
    publishedAt: string;
    imageUrl: string | null;
    excerpt: string | null;
  }>;
  newProducts: Array<{
    handle: string;
    title: string;
    publishedAt: string;
    imageUrl: string | null;
    excerpt: string | null;
  }>;
};

async function fetchFarmersWithNewContent(
  since: Date
): Promise<SanityFarmerWithContent[]> {
  const sinceISO = since.toISOString();

  /**
   * Fetch articles related to each farmer published after `since`.
   * Articles link to farmers via the `people` reference array.
   */
  const articlesQuery = `
    *[_type == "article" && publishedAt > $since && defined(people)] {
      "slug": slug.current,
      "title": title,
      "publishedAt": publishedAt,
      "imageUrl": headerImage.asset->url,
      "excerpt": excerpt,
      "farmerSlugs": people[]->slug.current
    }
  `;

  const articles: Array<{
    slug: string;
    title: string;
    publishedAt: string;
    imageUrl: string | null;
    excerpt: string | null;
    farmerSlugs: string[];
  }> = await sanityClient.fetch(articlesQuery, { since: sinceISO });

  // Build a map: farmerSlug -> new articles
  const farmerArticleMap = new Map<string, (typeof articles)[0][]>();

  for (const article of articles) {
    for (const slug of article.farmerSlugs ?? []) {
      if (!farmerArticleMap.has(slug)) farmerArticleMap.set(slug, []);
      farmerArticleMap.get(slug)!.push(article);
    }
  }

  // Fetch all involved farmers for their display names
  const involvedSlugs = [...farmerArticleMap.keys()];
  if (involvedSlugs.length === 0) return [];

  const farmersQuery = `
    *[_type == "farmer" && slug.current in $slugs] {
      "slug": slug.current,
      "name": name
    }
  `;
  const fetchedFarmers: Array<{ slug: string; name: string }> =
    await sanityClient.fetch(farmersQuery, { slugs: involvedSlugs });

  /**
   * 架空の農家についてはメールを組み立てない。この経路は公開ページではなく
   * フォロワーの受信箱に届くぶん、遮断の必要はむしろ強い — 架空の生産者名を
   * 実在の顧客に断言したうえ、本文のリンク先 `/farmers/{slug}` は deny-list 側で
   * 404 になるので、届いた時点で壊れている。`filterOutFictional` は `slug.current`
   * を見るので、この射影 (`"slug": slug.current`) に合わせて形を渡す。
   */
  const farmers = filterOutFictional(
    "farmer",
    fetchedFarmers.map((f) => ({ ...f, slug: { current: f.slug } })),
  ).map((f) => ({ ...f, slug: f.slug.current }));

  return farmers.map((f) => ({
    farmerSlug: f.slug,
    farmerName: f.name,
    newArticles: (farmerArticleMap.get(f.slug) ?? []).map((a) => ({
      slug: a.slug,
      title: a.title,
      publishedAt: a.publishedAt,
      imageUrl: a.imageUrl,
      excerpt: a.excerpt,
    })),
    // NOTE: Product notifications via Shopify would require a separate
    // integration (e.g., Shopify Webhook -> Firestore event flag).
    // Currently only article-based notifications are supported.
    newProducts: [],
  }));
}

// ─── Firestore helpers ────────────────────────────────────────────────

type FollowerDoc = {
  farmerSlug: string;
  farmerName: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
};

async function getFollowersForFarmer(
  farmerSlug: string
): Promise<FollowerDoc[]> {
  const db = getAdminFirestore();

  // Collection group query: all `follows` subcollections where farmerSlug matches
  const snapshot = await db
    .collectionGroup("follows")
    .where("farmerSlug", "==", farmerSlug)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    // Path: users/{customerId}/follows/{docId}
    const customerId = doc.ref.parent.parent?.id ?? "";
    return {
      farmerSlug: data.farmerSlug as string,
      farmerName: data.farmerName as string,
      customerId,
      customerEmail: data.customerEmail as string,
      customerName: data.customerName as string,
    };
  });
}

/**
 * Check if we already sent a notification to this customer for this farmer
 * within the last 23 hours.
 */
async function wasAlreadyNotified(
  customerId: string,
  farmerSlug: string
): Promise<boolean> {
  const db = getAdminFirestore();
  const docRef = db
    .collection("notificationState")
    .doc(customerId)
    .collection("farmerNotifications")
    .doc(farmerSlug);

  const doc = await docRef.get();
  if (!doc.exists) return false;

  const lastSentAt = doc.data()?.lastSentAt?.toDate?.() as Date | undefined;
  if (!lastSentAt) return false;

  const hoursSinceLast =
    (Date.now() - lastSentAt.getTime()) / (1000 * 60 * 60);
  return hoursSinceLast < 23;
}

async function markAsNotified(
  customerId: string,
  farmerSlug: string
): Promise<void> {
  const db = getAdminFirestore();
  const docRef = db
    .collection("notificationState")
    .doc(customerId)
    .collection("farmerNotifications")
    .doc(farmerSlug);

  await docRef.set({ lastSentAt: new Date() }, { merge: true });
}

// ─── Route handler ────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const results: {
    farmerSlug: string;
    customerId: string;
    status: "sent" | "skipped" | "error";
    detail?: string;
  }[] = [];

  try {
    const farmersWithContent = await fetchFarmersWithNewContent(since);

    if (farmersWithContent.length === 0) {
      return NextResponse.json({
        message: "No new content from followed farmers",
        since: since.toISOString(),
        sent: 0,
      });
    }

    for (const farmer of farmersWithContent) {
      const followers = await getFollowersForFarmer(farmer.farmerSlug);

      for (const follower of followers) {
        // Deduplication check
        const alreadySent = await wasAlreadyNotified(
          follower.customerId,
          farmer.farmerSlug
        );
        if (alreadySent) {
          results.push({
            farmerSlug: farmer.farmerSlug,
            customerId: follower.customerId,
            status: "skipped",
            detail: "Already notified within 23h",
          });
          continue;
        }

        // Build notification items
        const newItems: FarmerNotificationItem[] = [
          ...farmer.newArticles.map(
            (a): FarmerNotificationItem => ({
              type: "article",
              slug: a.slug,
              title: a.title,
              imageUrl: a.imageUrl,
              url: `${SITE_URL}/ja/journal/${a.slug}`,
              excerpt: a.excerpt,
            })
          ),
          ...farmer.newProducts.map(
            (p): FarmerNotificationItem => ({
              type: "product",
              slug: p.handle,
              title: p.title,
              imageUrl: p.imageUrl,
              url: `${SITE_URL}/ja/products/${p.handle}`,
              excerpt: p.excerpt,
            })
          ),
        ];

        if (newItems.length === 0) continue;

        try {
          const result = await sendFarmerNotification({
            customerEmail: follower.customerEmail,
            customerName: follower.customerName,
            farmerName: farmer.farmerName,
            farmerSlug: farmer.farmerSlug,
            newItems,
          });

          if (result.success) {
            await markAsNotified(follower.customerId, farmer.farmerSlug);
          }

          results.push({
            farmerSlug: farmer.farmerSlug,
            customerId: follower.customerId,
            status: result.success ? "sent" : "error",
            detail: result.error,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          results.push({
            farmerSlug: farmer.farmerSlug,
            customerId: follower.customerId,
            status: "error",
            detail: message,
          });
          Sentry.captureException(err, {
            tags: { cron: "farmer-notification" },
            extra: {
              farmerSlug: farmer.farmerSlug,
              customerId: follower.customerId,
            },
          });
        }
      }
    }

    const sent = results.filter((r) => r.status === "sent").length;
    const errors = results.filter((r) => r.status === "error").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    console.log(
      `[FarmerNotification] ${sent} sent, ${errors} errors, ${skipped} skipped`
    );

    return NextResponse.json({
      since: since.toISOString(),
      farmersWithNewContent: farmersWithContent.length,
      sent,
      errors,
      skipped,
      results,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: "farmer-notification" } });
    console.error("[FarmerNotification] Fatal error:", err);
    return NextResponse.json(
      { error: "Farmer notification cron failed" },
      { status: 500 }
    );
  }
}
