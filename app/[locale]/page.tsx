import type { Metadata } from "next";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";

import { SiteImage } from "@/components/site-image";
import { Skeleton } from "@/components/ui/skeleton";
import { CatalogGrid } from "@/components/catalog/catalog-list";
import {
  SectionBody,
  SectionHead,
  SpecBand,
  TripleColumn,
} from "@/components/editorial/section-blocks";
import { ProductCard } from "@/components/product/product-card";
import { Link } from "@/i18n/navigation";
import {
  ActionTile,
  ActionTileGrid,
  ChapterStatement,
  FeedList,
  QuietLinkRow,
  ServiceGuideBlock,
  TopHero,
  TopSection,
  TopSectionHead,
  type FeedItem,
} from "@/components/marketing/top-blocks";
import { getClient } from "@/sanity/lib/client";
import { filterOutFictional } from "@/lib/fictional-content";
import { excludeReservedTitles } from "@/lib/navigation/reserved-destinations";
import {
  ARTICLES_QUERY,
  EVENTS_QUERY,
  FEATURED_ARTICLES_QUERY,
  TOP_FARMER_VOICES_QUERY,
} from "@/sanity/lib/queries";
import { formatArticleDate, isPastEvent } from "@/lib/format-date";
import {
  isSeedId,
  previewSeedEnabled,
  seedEvents,
  seedFarmerVoices,
  seedTopNotices,
} from "@/lib/preview-seed";

/**
 * トップページ (/ja) — Figma【R2: 確定版】トップ (必須5本 + 追加4 /
 * 導線ブロック最下部) PC `8109:46558` / SP `8109:46620`
 * (file AWLnI0XF07e8rScuxPYPc7)。採用バナー `8114:23`
 * 「決定 2026/08/08 見た目一括承認 (Setaka)・凍結」。
 *
 * 節の順序 (Figma の上から):
 *  1. Hero (非対称 2 カラム / 8109:46560)
 *  2. 新着・季節の一報 SEASONAL (8110:2503)   → 最新記事 3 件
 *  3. 茶 (EC) 4 点 (8109:46596)               → Shopify 商品 4 件
 *  4. 茶を探す (カテゴリ) 6 タイル (8109:46568) → Shopify コレクション 6 件
 *  5. ジャーナル (8109:46605)                 → 特集記事 3 件
 *  6. イベント (8110:2516)                    → 開催予定イベント 3 件
 *  7. roji 定期便 (8110:2527)                 → SpecBand (定期便LP と同文言)
 *  8. つくり手が見える VOICES (8110:2542)     → 一言のある農家 3 件
 *  9. About / 章切り・明度反転 (8109:46592)
 * 10. 導線ブロック (8109:46616)
 * 11. 購入導線 (8109:46617)
 *
 * データが無い節は枠ごと出さない (空枠を出さない方針 — C4-2 / C4-3 と同じ)。
 *
 * 既知の差分 (忠実度対比表 docs/fidelity/c8-1-fidelity.md と対応):
 * - 主見出しは Figma 52px (en/h1) だが全体裁定により 44px display (`.hero-display`)。
 * - Figma の「茶葉診断への入口 (お茶カルテ)」節 (8110:2514) は `/karte` /
 *   `/diagnosis` が未実装のため出していない (存在しないルートへリンクしない)。
 * - カテゴリ 6 タイルと一報リストの文言は Figma の固定文言を焼かず実データから
 *   組む (商品一覧 R2 でチップ文言を productType から組んでいるのと同じ方針)。
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  const th = await getTranslations("homeR2");
  // The `%s | elxea` title.template lives in this same route segment's layout
  // (app/[locale]/layout.tsx). Next.js applies title.template only to CHILD
  // segments, never the segment where it is defined — so the home page (same
  // segment) does not inherit the brand suffix automatically. Emit the branded
  // title explicitly to keep "elxea" in the top page <title>.
  const brandedTitle = `${t("tagline")} | elxea`;
  return {
    title: brandedTitle,
    description: th("heroLead"),
    openGraph: {
      title: brandedTitle,
      description: th("heroLead"),
    },
  };
}

export default async function HomePage() {
  const t = await getTranslations("homeR2");

  return (
    <>
      <TopHero
        title={t("heroTitle")}
        subtitle={t("heroSubtitle")}
        lead={t("heroLead")}
        ctaHref="/products"
        ctaLabel={t("heroCta")}
        image={
          <SiteImage
            slotId="site:top:hero-01"
            src="/hero-day.jpg"
            fallbackSrc="/placeholder-hero-day.jpg"
            alt=""
            aria-hidden="true"
            width={864}
            height={560}
            priority
            sizes="(max-width: 1024px) 100vw, 864px"
            /* Figma の写真枠は SP 375x300 (5/4) / PC 864x560。インライン style が
               常に勝つので、比だけを CSS 変数でブレークポイント切替する
               (HeroFeature 8085:4305 と同じ手)。 */
            className="w-full bg-muted object-cover [--top-hero-ar:5/4] lg:rounded-md lg:[--top-hero-ar:864/560]"
            style={{ aspectRatio: "var(--top-hero-ar)" }}
          />
        }
      />

      <Suspense fallback={null}>
        <SeasonalSection />
      </Suspense>

      {/* Figma SP は上下 64 (8109:46644)。PC は他節と同じ 96。
          SP の head は見出し「茶葉」1 本だけで、PC の キッカー "TEA LEAVES"
          (8109:46598) を持たないので SP では出さない。 */}
      <TopSection className="py-16 lg:py-24">
        <TopSectionHead overline="TEA LEAVES" title={t("teaTitle")} overlineSpHidden />
        <Suspense fallback={<FeaturedProductsSkeleton />}>
          <FeaturedProducts />
        </Suspense>
      </TopSection>

      <Suspense fallback={null}>
        <CategoriesSection />
      </Suspense>

      <Suspense fallback={null}>
        <JournalSection />
      </Suspense>

      <Suspense fallback={null}>
        <EventsSection />
      </Suspense>

      <SubscriptionSection />

      <Suspense fallback={null}>
        <VoicesSection />
      </Suspense>

      <ChapterStatement
        overline="OUR PHILOSOPHY"
        title={t("chapterTitle")}
        body={t("chapterBody")}
      />

      <ServiceGuideBlock
        overline="ELXEA — OVERVIEW"
        title={t("guideTitle")}
        lead={t("guideLead")}
        tiles={[
          {
            overline: "TEA",
            title: t("guideTeaTitle"),
            body: t("guideTeaBody"),
            href: "/products",
            linkLabel: t("guideTeaLink"),
          },
          {
            overline: "JOURNAL",
            title: t("guideJournalTitle"),
            body: t("guideJournalBody"),
            href: "/journal",
            linkLabel: t("guideJournalLink"),
          },
          {
            overline: "EVENT",
            title: t("guideEventTitle"),
            body: t("guideEventBody"),
            href: "/events",
            linkLabel: t("guideEventLink"),
          },
          {
            /* Figma は「roji について」。専用の /roji ルートは無く、roji の実体は
               定期便サービスなので定期便LP (/subscription) へ通す。 */
            overline: "ROJI",
            title: t("guideRojiTitle"),
            body: t("guideRojiBody"),
            href: "/subscription",
            linkLabel: t("guideRojiLink"),
          },
        ]}
        about={{
          title: t("guideAboutTitle"),
          body: t("guideAboutBody"),
          href: "/about",
          linkLabel: t("guideAboutLink"),
        }}
      />

      {/* Figma SP は上下 64 (8109:46649)。PC は 96。 */}
      <TopSection className="py-16 lg:py-24">
        <QuietLinkRow href="/products" label={t("purchaseLink")} />
      </TopSection>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. 新着・季節の一報 (SEASONAL) — 最新記事 3 件 (Figma 8110:2503)             */
/* -------------------------------------------------------------------------- */

type ArticleRow = {
  _id: string;
  title: string;
  slug: { current: string };
  publishedAt?: string;
};

/** 記事 3 件を一報リストの行に落とす。seed 行は詳細ルートが無いので一覧へ通す。 */
function toFeedItems(articles: readonly ArticleRow[]): FeedItem[] {
  return articles.slice(0, 3).map((article) => ({
    href: isSeedId(article._id) ? "/journal" : `/journal/${article.slug.current}`,
    title: article.title,
    meta: formatArticleDate(article.publishedAt) || undefined,
  }));
}

async function SeasonalSection() {
  const locale = await getLocale();
  const t = await getTranslations("homeR2");

  let articles: ArticleRow[] = [];
  try {
    articles = previewSeedEnabled()
      ? seedTopNotices()
      : await getClient().fetch(ARTICLES_QUERY, {
          language: locale,
          start: 0,
          end: 3,
        });
  } catch {
    return null;
  }

  const items = toFeedItems(articles ?? []);
  if (items.length === 0) return null;

  return (
    <TopSection aria-label={t("seasonalLabel")}>
      <TopSectionHead overline="SEASONAL" />
      <FeedList items={items} />
    </TopSection>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. 茶 (EC) — Shopify 商品 4 件 (Figma 8109:46596 / PC 4列 / SP 2枚)          */
/* -------------------------------------------------------------------------- */

/** Figma は PC 4 列 x 1 段 (8109:46600)、SP は 2 枚 (8109:46646/46647)。 */
const TOP_PRODUCT_COUNT = 4;
const TOP_PRODUCT_COUNT_SP = 2;

async function FeaturedProducts() {
  const t = await getTranslations("home");

  try {
    const { getProducts } = await import("@/lib/shopify");
    const { products } = await getProducts({ first: TOP_PRODUCT_COUNT });
    if (products.length === 0) {
      return (
        <p className="mt-6 text-sm text-muted-foreground lg:mt-12">
          {t("productsPlaceholder")}
        </p>
      );
    }

    return (
      <CatalogGrid className="mt-6 grid-cols-1 lg:mt-12 lg:grid-cols-4">
        {products.map((product, i) => (
          <div
            key={product.id}
            /* SP は Figma の 2 枚に合わせる (3 枚目以降は PC のみ)。 */
            className={i >= TOP_PRODUCT_COUNT_SP ? "hidden lg:block" : undefined}
          >
            <ProductCard product={product} />
          </div>
        ))}
      </CatalogGrid>
    );
  } catch {
    return (
      <p className="mt-6 text-sm text-muted-foreground lg:mt-12">
        {t("productsPlaceholder")}
      </p>
    );
  }
}

function FeaturedProductsSkeleton() {
  return (
    <CatalogGrid className="mt-6 grid-cols-1 lg:mt-12 lg:grid-cols-4">
      {Array.from({ length: TOP_PRODUCT_COUNT }).map((_, i) => (
        <div
          key={i}
          className={i >= TOP_PRODUCT_COUNT_SP ? "hidden lg:block" : undefined}
        >
          <Skeleton className="aspect-[3/2] w-full" />
          <div className="mt-3 space-y-2 lg:mt-5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </div>
      ))}
    </CatalogGrid>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. 茶を探す (カテゴリ) — Shopify コレクション 6 件 (Figma 8109:46568)        */
/* -------------------------------------------------------------------------- */

/** Figma は PC 3 列 x 2 段 = 6 タイル (8109:46572 / 8109:46582)。 */
const TOP_CATEGORY_COUNT = 6;
/** Figma SP は 1 列 x 3 段 = 3 タイル (8109:46631 / 46634 / 46637)。 */
const TOP_CATEGORY_COUNT_SP = 3;

/**
 * カテゴリータイルに出してはいけない名前 = サイトの主要な行き先の名前。
 * 値は `messages` の `common.*` を引くので、名前の一覧をここに焼かない。
 */
const RESERVED_DESTINATION_KEYS = [
  "products",
  "subscription",
  "collections",
  "journal",
  "events",
  "teaMenu",
  "playlists",
  "about",
  "faq",
  "contact",
  "shipping",
  "search",
  "cart",
  "account",
] as const;

async function CategoriesSection() {
  const t = await getTranslations("homeR2");
  const tCommon = await getTranslations("common");

  try {
    const { getCollections } = await import("@/lib/shopify");
    /* 主要な行き先と同じ名前のコレクションは落とす (監査 #18)。本番には
       「イベント」という名前のコレクションがあり、タイルは「イベント」と
       名乗るのに着地先は商品一覧だった (2026-08-26 実測)。入口が多いことより
       先に、**同じ名前で違う場所へ連れて行くこと**が問題なので、そこだけ塞ぐ。
       判定は `lib/navigation/reserved-destinations.ts` (テスト済み)。

       写真があるカテゴリを先に並べる (#9)。
       写真の無いカテゴリは `ActionTile` が 1 行に畳むので、混ざった順のままだと
       写真タイルと 1 行タイルが市松に並んで段がガタつく。写真つきを前に寄せると
       上段が写真・下段が一覧という素直な並びになり、SP で先頭 3 枚を出す
       (下の `TOP_CATEGORY_COUNT_SP`) 判断とも噛み合う。

       絞り込みは **取得件数の上限を掛ける前** に行う。後ろでやると、落とした
       ぶんだけタイルが減る (6 件取って 1 件落とすと 5 件しか出ない)。 */
    const collections = excludeReservedTitles(
      /* 中身が空のコレクションは落とす (通しテスト E-3 / 2026-08-27)。本番の
         18 件のうち商品が所属しているのは 6 件だけで、トップに出ていた
         「お茶のコレクション」(`single-item`) は 0 件だった。押しても何も
         絞り込まれないタイルは、入口ではなく行き止まりである。

         落とす前提で取得件数を増やす (6 + 予約名 では足りない)。判定は
         `getCollections` が返す `hasProducts` — 呼び出し側で件数を推測しない。 */
      (await getCollections(50)).filter((c) => c.hasProducts),
      RESERVED_DESTINATION_KEYS.map((key) => tCommon(key)),
    )
      .slice(0, TOP_CATEGORY_COUNT)
      .sort((a, b) => Number(Boolean(b.image?.url)) - Number(Boolean(a.image?.url)));
    if (collections.length === 0) return null;

    /* Figma SP は上下 48 (8109:46629)。PC は 96。
       SP の head はキッカー "CATEGORIES" (8109:46630) だけで、PC の 32px 見出し
       (8109:46571) を持たない。タイルも SP は 3 枚 (節高 1037 =
       48 + 17 + 24 + 284x3 + 24x2 + 48)。 */
    return (
      <TopSection className="py-12 lg:py-24">
        <TopSectionHead
          overline="CATEGORIES"
          title={t("categoriesTitle")}
          titleSpHidden
        />
        <ActionTileGrid>
          {collections.map((collection, i) => (
            <ActionTile
              key={collection.handle}
              /* コレクション詳細 (/collections/[handle]) は 2026-08-14 に廃止。
                 着地先は商品一覧の絞り込みに一本化し、コレクション名を渡す。
                 商品一覧側は productType で拾えない名前を**コレクションの所属**
                 で絞る (`lib/shopify/category-filter.ts`)。以前は未知の名前を
                 黙って「すべて」に落としていたため、アソートセット / 定期便の
                 タイルを押しても 12 件が全部出ていた (通しテスト E-3)。 */
              href={`/products?category=${encodeURIComponent(collection.title)}`}
              image={collection.image?.url}
              imageAlt={collection.image?.altText || collection.title}
              label={collection.title}
              /* 4 枚目以降は PC のみ。実データが 1 件なら 1 枚しか出ない
                 (「データが無い節は出さない」方針と同じで、枠は作らない)。 */
              className={
                i >= TOP_CATEGORY_COUNT_SP ? "hidden lg:flex" : undefined
              }
            />
          ))}
        </ActionTileGrid>
      </TopSection>
    );
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* 5. ジャーナル (読みもの・CTA なし) — 特集記事 3 件 (Figma 8109:46605)        */
/* -------------------------------------------------------------------------- */

async function JournalSection() {
  const locale = await getLocale();
  const t = await getTranslations("homeR2");

  let articles: ArticleRow[] = [];
  try {
    articles = previewSeedEnabled()
      ? seedTopNotices("journal")
      : await getClient().fetch(FEATURED_ARTICLES_QUERY, { language: locale });
  } catch {
    return null;
  }

  const items = toFeedItems(articles ?? []);
  if (items.length === 0) return null;

  return (
    <TopSection aria-label={t("journalLabel")}>
      <TopSectionHead overline="JOURNAL" />
      <FeedList items={items} />
    </TopSection>
  );
}

/* -------------------------------------------------------------------------- */
/* 6. イベント (EVENT) — 開催予定 3 件 (Figma 8110:2516)                        */
/* -------------------------------------------------------------------------- */

type EventRow = {
  _id: string;
  title: string;
  slug: { current: string };
  date: string;
  endDate?: string;
  location?: string;
};

async function EventsSection() {
  const locale = await getLocale();
  const t = await getTranslations("homeR2");

  let events: EventRow[] = [];
  try {
    events = previewSeedEnabled()
      ? seedEvents()
      // Hide the fictional/seed events still present in the production dataset.
      : filterOutFictional(
          "event",
          await getClient().fetch(EVENTS_QUERY, { language: locale }),
        );
  } catch {
    return null;
  }

  // 過去日のイベントはトップにも出さない。一覧 (`/events`) と同じ判定を使う
  // ので、片方だけ過去日が残る状態にならない。
  const upcoming = (events ?? []).filter(
    (event) => !isPastEvent(event.date, event.endDate)
  );

  const items: FeedItem[] = upcoming.slice(0, 3).map((event) => {
    const date = formatArticleDate(event.date);
    return {
      // seed イベントには詳細ルートが無いので一覧へ通す。
      href: isSeedId(event._id) ? "/events" : `/events/${event.slug.current}`,
      title: event.title,
      meta: [date || null, event.location || null].filter(Boolean).join(" / ") || undefined,
    };
  });
  if (items.length === 0) return null;

  return (
    <TopSection aria-label={t("eventLabel")}>
      <TopSectionHead overline="EVENT" />
      <FeedList items={items} />
    </TopSection>
  );
}

/* -------------------------------------------------------------------------- */
/* 7. roji 定期便 — SpecBand 4 項目 (Figma 8110:2527)                           */
/* 文言は定期便LP R2 (`subscriptionR2.included*`) と同じキーを使い二重管理しない。*/
/* -------------------------------------------------------------------------- */

async function SubscriptionSection() {
  const ts = await getTranslations("subscriptionR2");

  return (
    <TopSection className="py-8 lg:py-16">
      <SpecBand
        items={[
          { term: ts("included1Term"), value: ts("included1Value") },
          { term: ts("included2Term"), value: ts("included2Value") },
          { term: ts("included3Term"), value: ts("included3Value") },
          { term: ts("included4Term"), value: ts("included4Value") },
        ]}
      />
    </TopSection>
  );
}

/* -------------------------------------------------------------------------- */
/* 8. つくり手が見える (VOICES) — 一言のある農家 3 件 (Figma 8110:2542)         */
/* -------------------------------------------------------------------------- */

type FarmerVoice = {
  _id: string;
  name: string;
  slug: { current: string };
  region?: string;
  quote: string;
};

async function VoicesSection() {
  const locale = await getLocale();
  const t = await getTranslations("homeR2");

  let voices: FarmerVoice[] = [];
  try {
    voices = previewSeedEnabled()
      ? seedFarmerVoices()
      : // 架空の農家プロフィールはこの節にも出さない。TOP_FARMER_VOICES_QUERY は
        // `quote` の入った農家だけを引くので、いま本番にいる架空 4 件は quote 未入力の
        // ぶん一件も釣れない — が、Studio で一言が入った瞬間にトップの一等地へ出て
        // しまう。ほかの farmer 経路 (about / farmers/[slug] / sitemap) と同じく
        // deny-list を通しておく。
        filterOutFictional(
          "farmer",
          await getClient().fetch<FarmerVoice[]>(TOP_FARMER_VOICES_QUERY, {
            language: locale,
          }),
        );
  } catch {
    return null;
  }

  const items = (voices ?? []).slice(0, 3);
  if (items.length === 0) return null;

  return (
    <TopSection className="py-8 lg:pt-24 lg:pb-16">
      {/* Figma 8110:2544 は「定期便LP R2 整合」の節見出し = jp/h3 20px (h27)。
          トップ固有の 32px 見出し (TopSectionHead) ではなく、商品詳細 / 定期便LP と
          共有の SectionHead (section-title = h3 トークン) を使う。 */}
      <SectionHead overline="VOICES" title={t("voicesTitle")} />
      <SectionBody>
        <TripleColumn
          items={items.map((voice) => {
            const label = voice.region
              ? `${voice.region} ${voice.name}`
              : voice.name;
            return {
              /* 農家詳細への導線。seed は詳細ルートを持たず、逃がし先だった
                 農家一覧 (/farmers) も 2026-08-14 に廃止したので、seed のときは
                 リンクを張らず見出しだけ出す (404 になる導線を作らない)。 */
              title: isSeedId(voice._id) ? (
                label
              ) : (
                <Link
                  href={`/farmers/${voice.slug.current}`}
                  className="underline-offset-4 hover:underline"
                >
                  {label}
                </Link>
              ),
              body: voice.quote,
            };
          })}
        />
      </SectionBody>
    </TopSection>
  );
}
