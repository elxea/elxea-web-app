import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import {
  ARTICLES_BY_CATEGORY_QUERY,
  ARTICLES_QUERY,
  CATEGORIES_WITH_COUNTS_QUERY,
} from "@/sanity/lib/queries";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import { ArticleCard } from "@/components/journal/article-card";
import { CategoryShelf, StackPageHead } from "@/components/journal/journal-list";
import { formatArticleDate } from "@/lib/format-date";

/**
 * ジャーナル:カテゴリ (索引) — Figma【R2: 確定版】統一ナビ + 縦積み一覧
 * (PC 8083:4073 / SP 8083:4217)。
 *
 * タブで 1 カテゴリずつ切り替えるのではなく、全カテゴリを「棚」として縦に
 * 積んで通読できるページ。棚ごとに PC 3 枚 / SP 1 枚のカードと
 * 「◯◯を、もっと見る →」を置き、そこから単一カテゴリページへ降りる。
 *
 * Figma 実測 (px) → 実装:
 * - CategoryStackHead  TitleCol 幅832 / リード幅640 / 行間12、Meta は PC 右端 2 行
 * - NavBar             一覧R2と同一の Toolbar (Chip h44 / 全丸め / gap8)
 * - CategoryShelf      pad-top64 → ShelfHead h44 → PC40/SP24 → カード → PC40/SP24
 *                      → もっと見る (h42 ≒ タップ域44)
 * - ShelfCards         PC 3列416 gap-x32 / SP 1列343 (全幅)
 *
 * 取得はカテゴリごとの個別クエリ (A4)。以前は全記事を `[0...60]` で引いて
 * メモリ上で棚に振り分けていたため、記事が 60 件を超えると「12本」と件数は
 * 出ているのにカードが 1 枚も無い棚が生まれ、そのまま `return null` で棚ごと
 * 消えていた (棚消失)。棚に出すのは各カテゴリ先頭 3 件だけなので、
 * カテゴリごとに 3 件だけ引けば件数と中身が食い違わない。
 */

/** Figma の棚は PC 3 枚 (8083:4089)。SP は 1 枚だけ見せる (8083:4232)。 */
const SHELF_SIZE = 3;

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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("journal");
  return {
    title: t("categoryStackTitle"),
    description: t("categoryStackDescription"),
  };
}

export default async function JournalCategoryIndexPage() {
  const locale = await getLocale();
  const t = await getTranslations("journal");
  const bt = await getTranslations("breadcrumb");
  const tCommon = await getTranslations("common");
  const tl = await getTranslations("catalog");

  const client = getClient();

  let rawCategories: CategoryItem[] = [];
  let newestArticles: ArticleItem[] = [];
  try {
    [rawCategories, newestArticles] = await Promise.all([
      client.fetch(CATEGORIES_WITH_COUNTS_QUERY, { language: locale }),
      // 「最終更新」に使う最新 1 件だけ。全件を引く必要はない。
      client.fetch(ARTICLES_QUERY, { language: locale, start: 0, end: 1 }),
    ]);
  } catch {
    return (
      <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      </Section>
    );
  }

  // Sanity は ja/en で同名カテゴリが並ぶことがあるので slug で重複を落とす。
  const seen = new Set<string>();
  const categories = (rawCategories ?? [])
    .filter((cat) => {
      const key = cat.slug?.current;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((cat) => cat.count > 0);

  // 「最終更新」は最新記事の公開日。記事が無ければ出さない。
  const latest = (newestArticles ?? [])[0]?.publishedAt;

  const total = categories.reduce((sum, cat) => sum + cat.count, 0);

  // 棚ごとに先頭 3 件だけを引く。カテゴリ数ぶんの並列クエリになるが、
  // 1 本あたり 3 件と軽く、全件取得と違って件数と中身が必ず一致する。
  let shelves: ArticleItem[][] = [];
  try {
    shelves = await Promise.all(
      categories.map((cat) =>
        client.fetch(ARTICLES_BY_CATEGORY_QUERY, {
          language: locale,
          categorySlug: cat.slug.current,
          start: 0,
          end: SHELF_SIZE,
        })
      )
    );
  } catch {
    return (
      <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      </Section>
    );
  }

  const meta = [
    t("categoryStackMeta", { count: categories.length, total }),
    ...(latest ? [t("lastUpdated", { date: formatArticleDate(latest) })] : []),
  ];

  const chips = [
    { value: "__all__", label: tl("all"), href: "/journal/category" },
    ...categories.map((cat) => ({
      value: cat.slug.current,
      label: cat.title,
      href: `/journal/category/${cat.slug.current}`,
    })),
  ];

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: t("title"), href: "/journal" },
          { label: t("categories") },
        ]}
      />

      <StackPageHead
        overline="CATEGORIES"
        title={t("categoryStackTitle")}
        lead={t("categoryStackDescription")}
        meta={meta}
      />

      {/* Head → NavBar は Figma PC 64 (TitleRow 下端 abs357 → NavBar abs421 /
          8083:4073)。SP は Figma の CategoryStackHead 枠に下パディングが無く 0 に
          読めるが、兄弟のタグ SP (8082:4048 PageHead 下端178 → Chips 210) は 32 で
          あり、こちらを SP の意図として 32 を維持する【要判断】。 */}
      <CatalogToolbar
        className="mt-8 lg:mt-16"
        chips={chips}
        activeChip="__all__"
        sortLabel={tl("sortLabel")}
      />

      {categories.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("empty")}</p>
      ) : (
        categories.map((cat, catIndex) => {
          const shelf = shelves[catIndex] ?? [];
          if (shelf.length === 0) return null;
          return (
            <CategoryShelf
              key={cat._id}
              title={cat.title}
              count={t("articleCount", { count: cat.count })}
              moreHref={`/journal/category/${cat.slug.current}`}
              moreLabel={t("shelfMore", { name: cat.title })}
            >
              {shelf.map((article, index) => (
                <ArticleCard
                  key={article._id}
                  article={article}
                  memberOnlyLabel={tCommon("memberOnly")}
                  /* Figma は SP 1 枚 / PC 3 枚 (8083:4232 / 8083:4089)。 */
                  className={index > 0 ? "hidden lg:flex" : undefined}
                />
              ))}
            </CategoryShelf>
          );
        })
      )}
    </Section>
  );
}
