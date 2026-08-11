import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import {
  ARTICLES_BY_TAG_QUERY,
  TAG_BY_SLUG_QUERY,
  TAGS_WITH_COUNTS_QUERY,
  CATEGORIES_QUERY,
} from "@/sanity/lib/queries";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import { ListPageHead, MoreRow } from "@/components/catalog/catalog-list";
import { ArticleCard } from "@/components/journal/article-card";
import {
  ArticleRail,
  JournalGrid,
  JournalLayout,
  TagMap,
} from "@/components/journal/journal-list";
import { getPopularArticles, orderByPopularity } from "@/lib/journal/popular-articles";

/**
 * ジャーナル:タグ — Figma【R2: 確定版】統一ナビ (一覧R2と同一チップ列) +
 * タグマップ (PC 8082:3855 / SP 8082:4048)。
 *
 * 構成: Breadcrumb → PageHead → Toolbar (兄弟タグのチップ列 + 並び替え) →
 * [記事グリッド + サイドバー] → もっと見る → タグマップ。
 * PageHead / Toolbar / MoreRow / グリッド / サイドバーはジャーナル一覧 (C4-1)
 * と同じ部品をそのまま使い、このページ固有なのは「チップがタグページへの
 * リンクであること」と「下部のタグマップ」の 2 点だけ。
 *
 * Figma 実測 (px) → 実装:
 * - PageHead 内 gap        12                    → `gap-3`
 * - ブロック間の縦間隔     PC 48 / SP 32          → `mt-8 lg:mt-12`
 * - Chip                   h44 / 全丸め / gap8
 * - Main                   ArticleList 936 + gap32 + Rail 344
 * - グリッド               PC 2列452 gap-x32 gap-y64 / SP 2列163.5 gap-x16 gap-y32
 * - MoreRow                h48 / 全丸め / 中央
 * - TagMap                 罫1px → 64 → 見出し → PC40/SP24 → 3列(SP1列) 行h57
 */

/** Figma の記事グリッドは 2 列 x 3 段 = 6 件 (8082:3883)。 */
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

type TagItem = { _id: string; title: string; slug: { current: string }; count: number };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const tag = await getClient().fetch(TAG_BY_SLUG_QUERY, { tagSlug: slug });
    if (!tag) return {};
    const t = await getTranslations("journal");
    return {
      title: t("tagArchiveTitle", { name: tag.title }),
      description: t("tagArchiveDescription", { name: tag.title }),
    };
  } catch {
    return {};
  }
}

export default async function TagPage({
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

  let tag: { _id: string; title: string; slug: { current: string } } | null = null;
  let articles: ArticleItem[] = [];
  let tags: TagItem[] = [];
  let categories: { _id: string; title: string; slug: { current: string } }[] = [];
  try {
    [tag, articles, tags, categories] = await Promise.all([
      client.fetch(TAG_BY_SLUG_QUERY, { tagSlug: slug }),
      client.fetch(ARTICLES_BY_TAG_QUERY, {
        language: locale,
        tagSlug: slug,
        start: 0,
        end: 60,
      }),
      client.fetch(TAGS_WITH_COUNTS_QUERY, { language: locale }),
      client.fetch(CATEGORIES_QUERY),
    ]);
  } catch {
    notFound();
  }

  if (!tag) notFound();

  const list = articles ?? [];
  const allTags = tags ?? [];

  // 並び替え。Figma の Select (8082:3881) は一覧R2と同じ位置・同じ形。
  // タグページはパーソナライズを通さないので「新着順 / 古い順」の 2 つ。
  const sort = query.sort === "oldest" ? "oldest" : "newest";
  const ordered = sort === "oldest" ? [...list].reverse() : list;

  const show = Math.max(PAGE_SIZE, Number(query.show) || PAGE_SIZE);
  const visible = ordered.slice(0, show);
  const remaining = ordered.length - visible.length;

  const hrefWith = (extra: Record<string, string>) => {
    const usp = new URLSearchParams();
    if (sort !== "newest") usp.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) usp.set(k, v);
    const qs = usp.toString();
    return qs ? `/journal/tag/${slug}?${qs}` : `/journal/tag/${slug}`;
  };

  // Figma の Chips は「兄弟タグ」(8082:3870)。先頭は一覧へ戻る「すべての記事」。
  const chips = [
    { value: "__all__", label: t("allArticles"), href: "/journal" },
    ...allTags.slice(0, 8).map((item) => ({
      value: item.slug.current,
      label: item.title,
      href: `/journal/tag/${item.slug.current}`,
    })),
  ];

  // A10: 「人気の記事」を実際の閲覧数順にする (以前は窓の先頭 5 件)。
  // 実データが薄い / 取得できないときは従来どおり先頭 5 件に倒す。
  const railPopular = orderByPopularity(list, await getPopularArticles(RAIL_SIZE))
    .slice(0, RAIL_SIZE)
    .map((a) => ({ label: a.title, href: `/journal/${a.slug.current}` }));

  const seen = new Set<string>();
  const railCategories = (categories ?? [])
    .filter((c) => {
      const key = c.slug?.current;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => ({ label: c.title, href: `/journal/category/${c.slug.current}` }));

  const tagMapEntries = allTags.map((item) => ({
    label: item.title,
    count: item.count,
    href: `/journal/tag/${item.slug.current}`,
  }));

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: t("title"), href: "/journal" },
          { label: tag.title },
        ]}
      />

      <ListPageHead
        overline="TAG"
        title={t("tagHeading", { name: tag.title })}
        lead={t("tagArchiveDescription", { name: tag.title })}
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
          <p className="order-1 text-sm text-muted-foreground">{t("empty")}</p>
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

      <TagMap title={t("tagMapTitle")} entries={tagMapEntries} />
    </Section>
  );
}
