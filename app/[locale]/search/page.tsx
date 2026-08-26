import type { Metadata } from "next";
import { Suspense } from "react";
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
import { pillClass } from "@/components/ui/pill-button";
import {
  bodySmClass,
  captionClass,
  overlineClass,
} from "@/components/editorial/rule-list";
import { productTypeLabel } from "@/lib/shopify/product-type";
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

      {/* まだ何も入力していない画面。以前はここが入力欄 1 つだけで、本文は
          242 文字しか無かった (監査 #21 / 2026-08-25) — 「何を打てばいいのか」
          の手がかりがゼロなので、キーワードを持っていない人はそのまま戻る。
          手がかりは**実データから**組む (固定の「人気キーワード」を焼くと、
          商品が入れ替わった日に嘘になる)。取得が遅くても入力欄は先に出したい
          ので Suspense で切り離す。 */}
      {query ? null : (
        <Suspense fallback={null}>
          <SearchStarters />
        </Suspense>
      )}

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

/* -------------------------------------------------------------------------- */
/* 検索の初期画面 — 何を打てばいいかの手がかり (監査 #21)                        */
/* -------------------------------------------------------------------------- */

/**
 * 入力前の画面に置く出発点。
 *
 * 手がかりは 2 段で出す:
 *
 *   1. **お茶の種類** — Shopify の `productType` から実データで組む。値は生の
 *      `productType` を URL に載せ、ラベルだけロケール側に落とす (商品一覧の
 *      チップと同じ規則 = `productTypeLabel`)。着地先も商品一覧の絞り込みに
 *      揃えるので、ここから入っても一覧から入っても同じ画面になる。
 *   2. **ほかの入口** — 探すのが検索でなくてよい人のための面 (一覧 / 読みもの /
 *      お茶メニュー)。3 つに絞る (トップの導線重複と同じ轍を踏まない)。
 *
 * 「人気キーワード」を固定文言で焼かないのは、根拠になる集計が今どこにも無い
 * ため。**無い根拠を語るより、実在する分類を出す**。
 */
async function SearchStarters() {
  const locale = await getLocale();
  const t = await getTranslations("search");
  const tCommon = await getTranslations("common");

  let categories: string[] = [];
  try {
    const { getProducts } = await import("@/lib/shopify");
    const { products } = await getProducts({ first: 60 });
    categories = [...new Set(products.map((p) => p.productType).filter(Boolean))];
  } catch {
    /* 取得に失敗しても検索そのものは使える。手がかりだけ黙って畳む。 */
    categories = [];
  }

  const outlets = [
    { href: "/products", label: tCommon("products") },
    { href: "/journal", label: tCommon("journal") },
    { href: "/tea-menu", label: tCommon("teaMenu") },
  ];

  return (
    <div className="mx-auto mt-12 max-w-2xl lg:mt-16">
      {categories.length > 0 ? (
        <section>
          <p className={cn(overlineClass, "text-muted-foreground")}>
            {t("startersHeading")}
          </p>
          <p className={cn(bodySmClass, "mt-2 text-muted-foreground")}>
            {t("startersLead")}
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {categories.map((category) => (
              <li key={category}>
                <Link
                  href={`/products?category=${encodeURIComponent(category)}`}
                  className={pillClass("outline")}
                >
                  {productTypeLabel(category, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={categories.length > 0 ? "mt-12" : undefined}>
        <p className={cn(overlineClass, "text-muted-foreground")}>
          {t("startersMoreHeading")}
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {outlets.map((outlet) => (
            <li key={outlet.href}>
              <Link
                href={outlet.href}
                className={cn(
                  bodySmClass,
                  "inline-flex min-h-11 items-center text-foreground underline underline-offset-4",
                )}
              >
                {outlet.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
