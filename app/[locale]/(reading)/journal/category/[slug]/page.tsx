import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import {
  ARTICLES_BY_CATEGORY_ASC_QUERY,
  ARTICLES_BY_CATEGORY_COUNT_QUERY,
  ARTICLES_BY_CATEGORY_QUERY,
  CATEGORIES_WITH_COUNTS_QUERY,
} from "@/sanity/lib/queries";
import { Link } from "@/i18n/navigation";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { pillClass } from "@/components/ui/pill-button";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import { ListPageHead, MoreRow } from "@/components/catalog/catalog-list";
import { ArticleCard } from "@/components/journal/article-card";
import { ArticleRail, JournalGrid, JournalLayout } from "@/components/journal/journal-list";
import { getPopularArticles, orderByPopularity } from "@/lib/journal/popular-articles";

/**
 * ジャーナル:カテゴリ (単一) — Figma【R2: 確定版】の「統一ナビ (一覧R2と同一
 * チップ列)」パターン。確定版に単一カテゴリの専用フレームは無く、カテゴリ索引
 * (8083:4073) の「◯◯を、もっと見る →」の降り先として必要なため、同じ確定版の
 * タグページ (8082:3855) と同一骨格で実装している (チップ列がカテゴリになる
 * だけの差)。タグページとの違いは下部のタグマップを置かないこと。
 *
 * 取得は `?show=` 連動のサーバサイド範囲取得 (A4)。以前は `[0...60]` 固定だった
 * ため、1 カテゴリに 61 件以上あると残りへ到達できなかった。古い順は
 * `[...list].reverse()` では取得した窓の中しか反転できないので、Sanity 側で
 * 昇順に並べたクエリを使う。
 */

/** Figma の記事グリッドは 2 列 x 3 段 = 6 件 (8082:3883 と同じ)。 */
const PAGE_SIZE = 6;

/** サイドバー「人気の記事」の件数 (Figma 8082:3893 は 5 行)。 */
const RAIL_SIZE = 5;

type SearchParams = { sort?: string; show?: string };

type ArticleItem = {
  _id: string;
  slug: { current: string };
  title: string;
  excerpt?: string;
  thumbnail?: { asset: object; alt?: string };
  mainImage?: { asset: object; alt?: string };
  publishedAt?: string;
  memberOnly?: boolean;
  category?: { title: string; slug: { current: string } };
  tags?: { _id: string; title: string; slug: { current: string } }[];
  author?: { name: string; image?: { asset: object } };
};

type CategoryItem = {
  _id: string;
  title: string;
  slug: { current: string };
  count: number;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const locale = await getLocale();
    const categories: CategoryItem[] = await getClient().fetch(CATEGORIES_WITH_COUNTS_QUERY, {
      language: locale,
    });
    const category = categories?.find((c) => c.slug?.current === slug);
    if (!category) return {};
    const t = await getTranslations("journal");
    return {
      title: t("categoryArchiveTitle", { name: category.title }),
      description: t("categoryArchiveDescription", { name: category.title }),
    };
  } catch {
    return {};
  }
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("journal");
  const bt = await getTranslations("breadcrumb");
  const tCommon = await getTranslations("common");
  const tl = await getTranslations("catalog");

  const client = getClient();

  const sort = query.sort === "oldest" ? "oldest" : "newest";
  const show = Math.max(PAGE_SIZE, Number(query.show) || PAGE_SIZE);

  // A7: 障害を notFound() に握り潰すと「本物の 404」と区別がつかず、Sentry にも
  // 上がらないまま「カテゴリが消えた」ように見える。取得失敗は他ページと同じ
  // loadError 表示にし、404 は「取得できたがカテゴリが無い」場合だけに絞る。
  let rawCategories: CategoryItem[] = [];
  let articles: ArticleItem[] = [];
  let total = 0;
  try {
    [rawCategories, articles, total] = await Promise.all([
      client.fetch(CATEGORIES_WITH_COUNTS_QUERY, { language: locale }),
      client.fetch(
        sort === "oldest" ? ARTICLES_BY_CATEGORY_ASC_QUERY : ARTICLES_BY_CATEGORY_QUERY,
        { language: locale, categorySlug: slug, start: 0, end: show }
      ),
      client.fetch(ARTICLES_BY_CATEGORY_COUNT_QUERY, {
        language: locale,
        categorySlug: slug,
      }),
    ]);
  } catch {
    return (
      <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
        <Breadcrumb
          items={[
            { label: bt("home"), href: "/" },
            { label: t("title"), href: "/journal" },
            { label: t("categories"), href: "/journal/category" },
          ]}
        />
        <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>
      </Section>
    );
  }

  const seen = new Set<string>();
  const categories = (rawCategories ?? []).filter((cat) => {
    const key = cat.slug?.current;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const category = categories.find((c) => c.slug.current === slug);
  if (!category) notFound();

  // 並び順は Sanity 側で確定済み (昇順 / 降順のクエリを使い分けている)。
  const list = articles ?? [];
  const visible = list.slice(0, show);
  // 残件は取得した窓ではなく総件数から出す (窓で判断すると窓の外に到達できない)。
  const remaining = Math.max(0, total - visible.length);

  const hrefWith = (extra: Record<string, string>) => {
    const usp = new URLSearchParams();
    if (sort !== "newest") usp.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) usp.set(k, v);
    const qs = usp.toString();
    return qs ? `/journal/category/${slug}?${qs}` : `/journal/category/${slug}`;
  };

  const chips = [
    { value: "__all__", label: tl("all"), href: "/journal/category" },
    ...categories
      .filter((c) => c.count > 0)
      .map((c) => ({
        value: c.slug.current,
        label: c.title,
        href: `/journal/category/${c.slug.current}`,
      })),
  ];

  // A10: 「人気の記事」を実際の閲覧数順にする。以前は取得した窓の先頭 5 件を
  // そのまま出しており、人気でも何でもなかった。実データが薄い / 取得できない
  // ときは従来どおり先頭 5 件に倒す。
  const railPopular = orderByPopularity(list, await getPopularArticles(RAIL_SIZE))
    .slice(0, RAIL_SIZE)
    .map((a) => ({ label: a.title, href: `/journal/${a.slug.current}` }));

  const railCategories = categories
    .filter((c) => c.count > 0)
    .map((c) => ({ label: c.title, href: `/journal/category/${c.slug.current}` }));

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: t("title"), href: "/journal" },
          { label: t("categories"), href: "/journal/category" },
          { label: category.title },
        ]}
      />

      <ListPageHead
        overline="CATEGORY"
        title={category.title}
        lead={t("categoryArchiveDescription", { name: category.title })}
      />

      <CatalogToolbar
        className="mt-8 lg:mt-12"
        chips={chips}
        activeChip={slug}
        activeSort={sort}
        sortLabel={tl("sortLabel")}
        sortOptions={[
          { value: "newest", label: tl("sortNewest") },
          { value: "oldest", label: tl("sortOldest") },
        ]}
      />

      <JournalLayout className="mt-8 lg:mt-12">
        {visible.length === 0 ? (
          <div className="order-1">
            {/* 絞り込みの結果として 0 件。障害 (loadError) とは必ず出し分ける
                — こちらは再試行ではなく絞り込みの解除を促す
                (Figma EmptyState 8173:298 の注記)。 */}
            <EmptyState
              count={t("emptyFilteredCount")}
              title={t("emptyFilteredTitle")}
              body={t("emptyFilteredBody")}
              action={
                <Link href="/journal" className={pillClass("outline")}>
                  {t("emptyFilteredAction")}
                </Link>
              }
            />
          </div>
        ) : (
          <JournalGrid>
            {visible.map((article) => (
              <ArticleCard
                key={article._id}
                article={article}
                memberOnlyLabel={tCommon("memberOnly")}
              />
            ))}
          </JournalGrid>
        )}

        {remaining > 0 ? (
          <MoreRow
            className="order-2 mt-8 lg:col-span-2 lg:mt-12"
            href={hrefWith({ show: String(show + PAGE_SIZE) })}
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
    </Section>
  );
}
