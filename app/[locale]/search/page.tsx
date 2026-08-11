import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { searchProducts } from "@/lib/shopify";
import type { Product } from "@/lib/shopify/types";
import { getClient } from "@/sanity/lib/client";
import {
  ARTICLES_SEARCH_COUNT_QUERY,
  ARTICLES_SEARCH_QUERY,
} from "@/sanity/lib/queries";
import { ProductGrid } from "@/components/product/product-grid";
import { ArticleCard } from "@/components/journal/article-card";
import { JournalGrid } from "@/components/journal/journal-list";
import { MoreRow } from "@/components/catalog/catalog-list";
import { Link } from "@/i18n/navigation";
import { SearchForm } from "@/components/search-form";
import { captionClass, overlineClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * 検索 (D2)。
 *
 * これまで商品 (Shopify) しか引いておらず、記事が増えるほど「サイト内で
 * 記事を探す手段が無い」状態だった (A4 で一覧の 60 件上限を外したことで
 * 記事数はさらに増える)。商品と記事を並列で引き、セクションを分けて出す。
 *
 * 部品はすべて既存 DS から取る (新規部品を作らない):
 * - 商品   … `ProductGrid` (中身は `CatalogGrid` + `ProductCard`)
 * - 記事   … `JournalGrid` + `ArticleCard` (ジャーナル一覧と同じカード)
 * - もっと … `MoreRow` (一覧・カテゴリ・タグと同じピル)
 */

export const metadata: Metadata = {
  title: "Search",
};

/** 記事の初期表示件数。ジャーナル一覧と同じ 2 列 x 3 段。 */
const ARTICLE_PAGE_SIZE = 6;

type SearchParams = { q?: string; articles?: string };

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

type ProductResults = { products: Product[]; totalCount: number } | null;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q, articles: articlesParam } = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("search");
  const tCommon = await getTranslations("common");
  const tl = await getTranslations("catalog");

  const query = (q ?? "").trim();
  const articleShow = Math.max(ARTICLE_PAGE_SIZE, Number(articlesParam) || ARTICLE_PAGE_SIZE);

  let productResults: ProductResults = null;
  let articles: ArticleItem[] = [];
  let articleTotal = 0;
  /** 商品・記事のどちらかでも取得に失敗したか (片側だけ落ちても黙らせない)。 */
  let productFailed = false;
  let articleFailed = false;

  if (query) {
    // GROQ の `match` は後方ワイルドカードを付けて前方一致にする。
    const term = `${query}*`;

    const [productSettled, articleSettled] = await Promise.allSettled([
      searchProducts(query),
      (async () => {
        const client = getClient();
        const [list, total] = await Promise.all([
          client.fetch(ARTICLES_SEARCH_QUERY, {
            language: locale,
            term,
            start: 0,
            end: articleShow,
          }),
          client.fetch(ARTICLES_SEARCH_COUNT_QUERY, { language: locale, term }),
        ]);
        return { list: (list ?? []) as ArticleItem[], total: (total ?? 0) as number };
      })(),
    ]);

    if (productSettled.status === "fulfilled") {
      productResults = productSettled.value;
    } else {
      productFailed = true;
    }

    if (articleSettled.status === "fulfilled") {
      articles = articleSettled.value.list;
      articleTotal = articleSettled.value.total;
    } else {
      articleFailed = true;
    }
  }

  const productCount = productResults?.totalCount ?? 0;
  const hasProducts = productCount > 0;
  const hasArticles = articles.length > 0;
  const anyFailed = productFailed || articleFailed;
  const remainingArticles = Math.max(0, articleTotal - articles.length);

  const moreArticlesHref = () => {
    const usp = new URLSearchParams();
    usp.set("q", query);
    usp.set("articles", String(articleShow + ARTICLE_PAGE_SIZE));
    return `/search?${usp.toString()}`;
  };

  return (
    <div className="section-wide py-20">
      {/* 検索フォームを中央寄せ editorial ヘッダーに (Figma 6677:8077) */}
      <div className="max-w-2xl mx-auto">
        <p className={cn(overlineClass, "mb-6 text-center text-muted-foreground")}>Search</p>
        <SearchForm initialQuery={query} />
      </div>

      {query && hasProducts ? (
        <section className="mt-16">
          <p className={cn(overlineClass, "text-muted-foreground")}>{t("productsHeading")}</p>
          <p className={cn(captionClass, "mt-2 mb-8 text-muted-foreground")}>
            {t("results", { count: productCount })}
          </p>
          <ProductGrid products={productResults?.products ?? []} />
        </section>
      ) : null}

      {query && hasArticles ? (
        <section className="mt-16">
          <p className={cn(overlineClass, "text-muted-foreground")}>{t("articlesHeading")}</p>
          <p className={cn(captionClass, "mt-2 mb-8 text-muted-foreground")}>
            {t("articleResults", { count: articleTotal })}
          </p>
          <JournalGrid>
            {articles.map((article) => (
              <ArticleCard
                key={article._id}
                article={article}
                locale={locale}
                memberOnlyLabel={tCommon("memberOnly")}
              />
            ))}
          </JournalGrid>
          {remainingArticles > 0 ? (
            <MoreRow
              className="mt-8 lg:mt-12"
              href={moreArticlesHref()}
              label={tl("showMore", {
                count: Math.min(remainingArticles, ARTICLE_PAGE_SIZE),
              })}
            />
          ) : null}
        </section>
      ) : null}

      {/* どちらも 0 件。取得に失敗した側があるときは「見つからない」と断定せず、
          読み込めなかったことを併記する (障害を「該当なし」に見せない)。 */}
      {query && !hasProducts && !hasArticles ? (
        <div className="mt-12 space-y-2">
          <p className="text-sm text-muted-foreground">{t("noResults", { q: query })}</p>
          {anyFailed ? (
            <p className="text-sm text-muted-foreground">{t("loadError")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Link href="/journal" className="underline underline-offset-4">
                {t("browseJournal")}
              </Link>
            </p>
          )}
        </div>
      ) : null}

      {/* 片側だけ落ちた場合。もう片側の結果は出したうえで、落ちた側を明示する。 */}
      {query && anyFailed && (hasProducts || hasArticles) ? (
        <p className="mt-12 text-sm text-muted-foreground">{t("partialLoadError")}</p>
      ) : null}
    </div>
  );
}
