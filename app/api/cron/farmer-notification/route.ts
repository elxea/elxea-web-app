import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/lib/config";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { sanityFetch } from "@/sanity/lib/fetch";
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

const CRON_SECRET = env("CRON_SECRET") ?? "";
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
  }> = await sanityFetch({
    query: articlesQuery,
    params: { since: sinceISO },
    // cron は「前回実行以降に増えた記事」を毎回実データで見る。名札で無効化
    // する対象ではない (キャッシュに当たると同じ通知を送らない/送りすぎる)。
    cache: { noStore: true },
  });

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
    await sanityFetch({
      query: farmersQuery,
      params: { slugs: involvedSlugs },
      cache: { noStore: true },
    });

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

/**
 * この農家を保存している人を集める。
 *
 * ## 2 か所を見て 1 つに束ねる (移行期の必須処理)
 *
 * 農家の保存先は `follows` から `favorites` (`type: "farmer"`) へ移した (J-5)。
 * 移行スクリプトは**元の `follows` を消さない**ので、移行の前後どちらの時点でも
 * 取りこぼしが出ないよう **両方を読んで人単位で束ねる**。
 *
 * 片方だけを読むと、その瞬間に配信が静かに止まる —
 *   - `favorites` だけ … 移行を流す前は 0 件になる (デプロイした瞬間に配信停止)
 *   - `follows` だけ  … 移行後に保存した人へ届かない (新規が永久に漏れる)
 * どちらも「エラーは出ないのに誰にも届かない」形の壊れ方をする。
 *
 * 同じ人が両方に居るのは移行後の正常な状態なので、`customerId` で重複を落とす。
 */
async function getFollowersForFarmer(
  farmerSlug: string
): Promise<FollowerDoc[]> {
  const db = getAdminFirestore();

  const [legacy, saved] = await Promise.all([
    // 旧: users/{customerId}/follows/{docId}
    db.collectionGroup("follows").where("farmerSlug", "==", farmerSlug).get(),
    // 新: users/{customerId}/favorites/{docId} (type: "farmer" / targetId: slug)
    db
      .collectionGroup("favorites")
      .where("type", "==", "farmer")
      .where("targetId", "==", farmerSlug)
      .get(),
  ]);

  const byCustomer = new Map<string, FollowerDoc>();

  for (const doc of legacy.docs) {
    const data = doc.data();
    const customerId = doc.ref.parent.parent?.id ?? "";
    if (!customerId) continue;
    byCustomer.set(customerId, {
      farmerSlug: data.farmerSlug as string,
      farmerName: data.farmerName as string,
      customerId,
      customerEmail: data.customerEmail as string,
      customerName: data.customerName as string,
    });
  }

  for (const doc of saved.docs) {
    const data = doc.data();
    const customerId = doc.ref.parent.parent?.id ?? "";
    if (!customerId || byCustomer.has(customerId)) continue;
    /* お気に入りの行は農家名 (`title`) しか持たない。宛先の氏名・メールは
       ここでは分からないので空にしておく — 呼び出し側が Shopify から引き直す
       ときに、推測した値で上書きされないようにする。 */
    byCustomer.set(customerId, {
      farmerSlug,
      farmerName: (data.title as string) ?? farmerSlug,
      customerId,
      customerEmail: "",
      customerName: "",
    });
  }

  return [...byCustomer.values()];
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
