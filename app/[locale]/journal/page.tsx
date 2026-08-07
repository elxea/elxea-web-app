import type { Metadata } from "next";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import { ARTICLES_QUERY, CATEGORIES_QUERY } from "@/sanity/lib/queries";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import { ListPageHead, MoreRow } from "@/components/catalog/catalog-list";
import { ImageCard } from "@/components/ui/image-card";
import { ArticleCard } from "@/components/journal/article-card";
import {
  ArticleRail,
  HeroFeature,
  JournalGrid,
  JournalLayout,
} from "@/components/journal/journal-list";
import { urlFor } from "@/sanity/lib/image";
import { previewSeedEnabled, previewImageForKey } from "@/lib/preview-seed";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { getRecommendedArticles } from "@/lib/recommendations/content-engine";

/**
 * ジャーナル一覧 — Figma【R2: 確定版】共通リストパターン整合 + 特集枠 +
 * サイドバー (PC 8073:44722 / SP 8074:4044) の実装。
 *
 * 構成: Breadcrumb → PageHead → 特集枠 → Toolbar (チップ + 並び替え) →
 * [記事グリッド + サイドバー] → もっと見る。PageHead / Toolbar / MoreRow は
 * 商品一覧・お茶メニューと同じ `components/catalog/*` を共有し、ジャーナル固有の
 * 3 部品だけ `components/journal/journal-list.tsx` に置く。
 *
 * 絞り込み (`?category=`) / 並び替え (`?sort=`) / 表示件数 (`?show=`) は URL に
 * 載せる。既定の並びは「おすすめ順」で、ログイン中は行動ログに基づく
 * パーソナライズ (`getRecommendedArticles`) が効く。
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("journal");
  return {
    title: t("title"),
    description: t("description"),
    openGraph: { title: t("title"), description: t("description") },
  };
}

/** Figma の記事グリッドは 2 列 x 3 段 = 6 件を初期表示する (8073:44998)。 */
const PAGE_SIZE = 6;

/** サイドバー「人気の記事」の件数 (Figma 8073:45005 は 5 行)。 */
const RAIL_SIZE = 5;

type SearchParams = { category?: string; sort?: string; show?: string };

type ArticleItem = {
  _id: string;
  slug: { current: string };
  title: string;
  excerpt?: string;
  thumbnail?: { asset: object; alt?: string };
  mainImage?: { asset: object; alt?: string };
  publishedAt?: string;
  memberOnly?: boolean;
  featured?: boolean;
  category?: { title: string; slug: { current: string } };
  tags?: { _id: string; title: string; slug: { current: string } }[];
  author?: { name: string; image?: { asset: object } };
  contentPersona?: string | string[] | null;
  depthLevel?: string | null;
  targetLayer?: string | null;
};

/** 特集写真は 1312x546 で切り出す (Figma 8073:44992)。無い記事はプレビュー用の
 *  ローカル画像にフォールバックする (本番では未設定なら空枠のまま)。 */
function heroImage(article: ArticleItem): string | undefined {
  const image = article.mainImage ?? article.thumbnail;
  if (image?.asset) return urlFor(image).width(1312).height(546).url();
  return previewSeedEnabled() ? previewImageForKey(article._id) : undefined;
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getTranslations("journal");
  const bt = await getTranslations("breadcrumb");

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: t("title") }]} />

      <ListPageHead overline="JOURNAL" title={t("title")} lead={t("description")} />

      <Suspense fallback={<JournalSkeleton />}>
        <JournalContent params={params} />
      </Suspense>
    </Section>
  );
}

function JournalSkeleton() {
  return (
    <JournalGrid className="mt-8 lg:mt-12">
      {Array.from({ length: PAGE_SIZE }).map((_, i) => (
        <div key={i} className="flex animate-pulse flex-col gap-4">
          <ImageCard />
          <div className="space-y-1.5">
            <div className="h-3 w-16 bg-muted" />
            <div className="h-4 w-3/4 bg-muted" />
            <div className="h-3 w-full bg-muted" />
          </div>
        </div>
      ))}
    </JournalGrid>
  );
}

async function JournalContent({ params }: { params: SearchParams }) {
  const locale = await getLocale();
  const t = await getTranslations("journal");
  const tCommon = await getTranslations("common");
  const tl = await getTranslations("catalog");

  let rawArticles: ArticleItem[];
  let rawCategories: { _id: string; title: string; slug: { current: string } }[];
  try {
    const client = getClient();
    [rawCategories, rawArticles] = await Promise.all([
      client.fetch(CATEGORIES_QUERY),
      client.fetch(ARTICLES_QUERY, { language: locale, start: 0, end: 60 }),
    ]);
  } catch {
    return <p className={"mt-8 text-sm text-muted-foreground lg:mt-12"}>{t("loadError")}</p>;
  }

  const articles = rawArticles ?? [];
  if (articles.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("empty")}</p>;
  }

  // Sanity は ja/en で同名カテゴリが並ぶことがあるので slug で重複を落とす。
  const seen = new Set<string>();
  const categories = (rawCategories ?? []).filter((cat) => {
    const key = cat.slug?.current;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const sort = params.sort === "oldest" || params.sort === "newest" ? params.sort : "recommended";

  const categorySlugs = new Set(
    articles.map((a) => a.category?.slug?.current).filter(Boolean) as string[]
  );
  const chips = [
    { value: "all", label: tl("all") },
    ...categories
      .filter((c) => categorySlugs.has(c.slug.current))
      .map((c) => ({ value: c.slug.current, label: c.title })),
  ];
  const activeCategory =
    params.category && categorySlugs.has(params.category) ? params.category : "all";

  // 特集枠は「編集判断で指定」(Figma 8073:44991)。Sanity の featured フラグを
  // 唯一の根拠にし、無ければ最新記事を充てる。絞り込み中は出さない
  // (絞り込み結果と特集が食い違うため)。
  const featured =
    activeCategory === "all"
      ? (articles.find((a) => a.featured) ?? articles[0])
      : undefined;

  const pool = articles.filter((a) => a._id !== featured?._id);
  const filtered =
    activeCategory === "all"
      ? pool
      : pool.filter((a) => a.category?.slug?.current === activeCategory);

  // 並び替え。既定 (おすすめ順) のときだけパーソナライズを通す。
  let ordered = filtered;
  if (sort === "oldest") {
    ordered = [...filtered].reverse();
  } else if (sort === "recommended") {
    let customerId: string | null = null;
    try {
      const auth = await requireAuth();
      if (auth.authenticated) customerId = auth.customerId;
    } catch {
      // 未ログインはそのまま (customerId = null)
    }
    ordered = await getRecommendedArticles({ customerId, rawArticles: filtered });
  }

  const show = Math.max(PAGE_SIZE, Number(params.show) || PAGE_SIZE);
  const visible = ordered.slice(0, show);
  const remaining = ordered.length - visible.length;

  const query = (extra: Record<string, string>) => {
    const usp = new URLSearchParams();
    if (activeCategory !== "all") usp.set("category", activeCategory);
    if (sort !== "recommended") usp.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) usp.set(k, v);
    const qs = usp.toString();
    return qs ? `/journal?${qs}` : "/journal";
  };

  const railPopular = articles
    .filter((a) => a.featured)
    .concat(articles.filter((a) => !a.featured))
    .slice(0, RAIL_SIZE)
    .map((a) => ({ label: a.title, href: `/journal/${a.slug.current}` }));

  const railCategories = chips
    .filter((c) => c.value !== "all")
    .map((c) => ({ label: c.label, href: `/journal?category=${c.value}` }));

  return (
    <>
      {featured ? (
        <HeroFeature
          className="mt-8 lg:mt-12"
          href={`/journal/${featured.slug.current}`}
          label={t("featured")}
          image={heroImage(featured)}
          imageAlt={featured.title}
          meta={[
            featured.category?.title,
            featured.publishedAt
              ? new Date(featured.publishedAt).toLocaleDateString(locale)
              : null,
          ]
            .filter(Boolean)
            .join(" — ")}
          title={featured.title}
          lead={featured.excerpt}
        />
      ) : null}

      <CatalogToolbar
        className="mt-8 lg:mt-12"
        chips={chips}
        activeChip={activeCategory}
        activeSort={sort}
        sortLabel={tl("sortLabel")}
        sortOptions={[
          { value: "recommended", label: tl("sortRecommended") },
          { value: "newest", label: tl("sortNewest") },
          { value: "oldest", label: tl("sortOldest") },
        ]}
      />

      <JournalLayout className="mt-8 lg:mt-12">
        {visible.length === 0 ? (
          <p className="order-1 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <JournalGrid>
            {visible.map((article) => (
              <ArticleCard
                key={article._id}
                article={article}
                locale={locale}
                memberOnlyLabel={tCommon("memberOnly")}
              />
            ))}
          </JournalGrid>
        )}

        {remaining > 0 ? (
          <MoreRow
            className="order-2 mt-8 lg:col-span-2 lg:mt-12"
            href={query({ show: String(show + PAGE_SIZE) })}
            label={tl("showMore", { count: Math.min(remaining, PAGE_SIZE) })}
          />
        ) : null}

        <ArticleRail
          popularTitle={t("popular")}
          popular={railPopular}
          categoryTitle={t("categories")}
          categories={railCategories}
        />
      </JournalLayout>
    </>
  );
}
