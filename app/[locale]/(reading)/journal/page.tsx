import type { Metadata } from "next";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { FilterX, Sprout } from "lucide-react";

import { sanityFetch } from "@/sanity/lib/fetch";
import {
  ARTICLES_ASC_QUERY,
  ARTICLES_BY_CATEGORY_ASC_QUERY,
  ARTICLES_BY_CATEGORY_COUNT_QUERY,
  ARTICLES_BY_CATEGORY_QUERY,
  ARTICLES_COUNT_QUERY,
  ARTICLES_QUERY,
  CATEGORIES_WITH_COUNTS_QUERY,
  FEATURED_ARTICLES_QUERY,
} from "@/sanity/lib/queries";
import { Link } from "@/i18n/navigation";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { pillClass } from "@/components/ui/pill-button";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import { ListPageHead, MoreRow } from "@/components/catalog/catalog-list";
import { ArticleCard } from "@/components/journal/article-card";
import { JournalGridSkeleton } from "@/components/journal/journal-skeleton";
import {
  ArticleRail,
  HeroFeature,
  JournalGrid,
  JournalLayout,
} from "@/components/journal/journal-list";
import { urlFor } from "@/sanity/lib/image";
import { formatArticleDate } from "@/lib/format-date";
import { previewSeedEnabled, previewImageForKey } from "@/lib/preview-seed";
import { requireAuth } from "@/lib/firebase/auth-guard";
import { getRecommendedArticles } from "@/lib/recommendations/content-engine";
import { getPopularArticles, orderByPopularity } from "@/lib/journal/popular-articles";
import {
  canUseSpeculativeBundle,
  resolveActiveCategory,
} from "@/lib/journal/active-category";

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
 *
 * 取得は `?show=` 連動のサーバサイド範囲取得 (A4)。以前は `[0...60]` 固定で
 * 全件を引き、絞り込み・並び替え・件数判定をすべてメモリ上で行っていたため、
 * 61 件目以降は一覧からもカテゴリ導線からも到達不能だった (sitemap や直リンクでは
 * 開けるので SEO には載るのに一覧に出ない「幽霊記事」になる)。
 * 「もっと見る」を出すかどうかは取得した窓ではなく総件数 (count) で決める。
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

/**
 * おすすめ順のときにパーソナライズへ渡す候補の最小数。
 * `getRecommendedArticles` は渡した集合を並べ替えるだけなので、候補が表示件数
 * ぴったりだと「今表示中の 6 件を並べ替える」だけになり推薦にならない。
 * 従来の固定 60 件取得と同じ広さを候補プールとして確保する。
 */
const RECOMMEND_POOL = 60;

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

      <Suspense fallback={<JournalGridSkeleton count={PAGE_SIZE} className="mt-8 lg:mt-12" />}>
        <JournalContent params={params} />
      </Suspense>
    </Section>
  );
}

async function JournalContent({ params }: { params: SearchParams }) {
  const locale = await getLocale();
  const t = await getTranslations("journal");
  const tCommon = await getTranslations("common");
  const tl = await getTranslations("catalog");

  const sort = params.sort === "oldest" || params.sort === "newest" ? params.sort : "recommended";
  const show = Math.max(PAGE_SIZE, Number(params.show) || PAGE_SIZE);

  /* ## 外部往復は「足し算」ではなく「いちばん長い 1 本」にする (LCP / W-B)
   *
   * この節は以前、外部への問い合わせを **4 段の直列**で回していた:
   *   カテゴリ件数 → 記事一覧ほか 4 本 → ログイン判定 → おすすめ並べ替え。
   * 段の数だけ往復が積み上がるので、一覧が届くまでの時間がそのまま
   * 「4 本の足し算」になる。ジャーナル一覧の LCP 要素 (記事の抜粋テキスト) は
   * この Suspense の内側にあるため、足し算がまるごと LCP に乗っていた。
   *
   * 実測 (本番 SP390 / 2026-08-25): サーバの送信完了 4,694ms → LCP 4,736ms。
   * LCP は送信完了の 42ms 後に立っており、**LCP を決めていたのはここ**だった
   * (監査 #14 が疑った写真とフォントではない。この一覧に写真は 2 枚しか無く、
   *  どちらもヘッダーのロゴで、特集写真には既に priority が付いている)。
   *
   * 依存関係を洗うと、直列にする必然があるのは最後の 1 段だけだった:
   *   - カテゴリ件数 … 記事一覧に依存しない
   *   - ログイン判定 … 何にも依存しない
   *   - おすすめ並べ替え … 記事一覧が要る (ここだけ本当に後段)
   * よって先に全部走らせ、最後にまとめて待つ。
   */
  const requestedCategory =
    typeof params.category === "string" && params.category ? params.category : undefined;

  // 1) チップ (カテゴリ) は記事の取得窓ではなく Sanity 側の件数で決める。
  //    以前は「取得した 60 件に現れたカテゴリ」だけを出していたため、61 件目
  //    以降にしか記事が無いカテゴリはチップごと消えていた。
  const categoriesPromise: Promise<
    { _id: string; title: string; slug: { current: string }; count: number }[]
  > = sanityFetch({
    query: CATEGORIES_WITH_COUNTS_QUERY,
    params: { language: locale },
    cache: { tag: "sanity:categories" },
  });

  // 人気の記事は全ユーザー共通の集計なので、記事の取得と並べて引く
  // (失敗しても空配列が返るだけで一覧の描画は止まらない)。
  const popularArticlesPromise = getPopularArticles(RAIL_SIZE);

  /* ログイン判定は誰にも依存しないので最初に投げる。おすすめ順のときしか使わない
     ので、それ以外では往復ごと発生させない。 */
  const customerIdPromise: Promise<string | null> =
    sort === "recommended"
      ? requireAuth()
          .then((auth) => (auth.authenticated ? auth.customerId : null))
          .catch(() => null)
      : Promise.resolve(null);

  /* 一覧側の 4 本。`?category=` の正当性はカテゴリ件数が返るまで確定しないが、
     **待たずに投げる**。指定が正しければそのまま使い、綴り違い等で外れたときだけ
     「絞り込みなし」で引き直す (従来と同じ挙動に落ちる)。外れは稀なので、
     通常の閲覧では往復が 1 段減る。 */
  const fetchListBundle = (activeCategory: string) => {
    const showsFeatured = activeCategory === "all";
    // 一覧から特集 1 件を抜くぶん、窓を 1 件多く取る。
    const fetchEnd =
      sort === "recommended"
        ? Math.max(show + (showsFeatured ? 1 : 0), RECOMMEND_POOL)
        : show + (showsFeatured ? 1 : 0);

    const listQuery =
      activeCategory === "all"
        ? sort === "oldest"
          ? ARTICLES_ASC_QUERY
          : ARTICLES_QUERY
        : sort === "oldest"
          ? ARTICLES_BY_CATEGORY_ASC_QUERY
          : ARTICLES_BY_CATEGORY_QUERY;

    const listParams =
      activeCategory === "all"
        ? { language: locale, start: 0, end: fetchEnd }
        : { language: locale, categorySlug: activeCategory, start: 0, end: fetchEnd };

    return Promise.all([
      sanityFetch<ArticleItem[]>({
        query: listQuery,
        params: listParams,
        cache: { tag: "sanity:articles" },
      }),
      // 特集候補 (最大 4 件・新しい順)。ヒーローとサイドバーの並びに使う。
      // 絞り込み中もサイドバーは全体の並びを出すので常に引く。
      sanityFetch<ArticleItem[]>({
        query: FEATURED_ARTICLES_QUERY,
        params: { language: locale },
        cache: { tag: "sanity:articles" },
      }),
      // サイドバー「人気の記事」の穴埋め用の最新記事。
      sanityFetch<ArticleItem[]>({
        query: ARTICLES_QUERY,
        params: { language: locale, start: 0, end: RAIL_SIZE },
        cache: { tag: "sanity:articles" },
      }),
      activeCategory === "all"
        ? sanityFetch<number>({
            query: ARTICLES_COUNT_QUERY,
            params: { language: locale },
            cache: { tag: "sanity:articles" },
          })
        : sanityFetch<number>({
            query: ARTICLES_BY_CATEGORY_COUNT_QUERY,
            params: { language: locale, categorySlug: activeCategory },
            cache: { tag: "sanity:articles" },
          }),
    ]);
  };

  const speculativeBundle = fetchListBundle(requestedCategory ?? "all");
  /* 捨てる可能性がある promise なので、握られない失敗にしない
     (unhandled rejection でプロセスに警告が出る)。実際の失敗は下の await で拾う。 */
  speculativeBundle.catch(() => undefined);

  let rawCategories: { _id: string; title: string; slug: { current: string }; count: number }[];
  try {
    rawCategories = await categoriesPromise;
  } catch {
    return <p className={"mt-8 text-sm text-muted-foreground lg:mt-12"}>{t("loadError")}</p>;
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

  const chips = [
    { value: "all", label: tl("all") },
    ...categories.map((c) => ({ value: c.slug.current, label: c.title })),
  ];
  const activeCategory = resolveActiveCategory(
    requestedCategory,
    categories.map((c) => c.slug.current),
  );

  // 2) 特集枠は「編集判断で指定」(Figma 8073:44991)。Sanity の featured フラグを
  //    唯一の根拠にし、無ければ最新記事を充てる。絞り込み中は出さない
  //    (絞り込み結果と特集が食い違うため)。特集は一覧の窓の外にあり得るので
  //    専用クエリで引く。
  const showsFeatured = activeCategory === "all";

  let windowArticles: ArticleItem[];
  let featuredArticles: ArticleItem[];
  let newestArticles: ArticleItem[];
  let total: number;
  try {
    /* 先読みが当たっていればそのまま使う。外れる (存在しないカテゴリを指定された)
       のは稀なので、そのときだけ絞り込みなしで引き直す。 */
    [windowArticles, featuredArticles, newestArticles, total] =
      canUseSpeculativeBundle(requestedCategory, activeCategory)
        ? await speculativeBundle
        : await fetchListBundle(activeCategory);
  } catch {
    return <p className={"mt-8 text-sm text-muted-foreground lg:mt-12"}>{t("loadError")}</p>;
  }

  if ((total ?? 0) === 0) {
    // P1 絞り込み以前に記事が 1 本も無い状態。解除できる絞り込みが無いので、
    // 導線は横に抜ける出口 (商品一覧) にする。
    return (
      <EmptyState
        className="mt-8 lg:mt-12"
        icon={Sprout}
        count={t("emptyAll.eyebrow")}
        title={t("emptyAll.title")}
        body={t("emptyAll.body")}
        action={
          <Link href="/products" className={pillClass("outline")}>
            {t("emptyAll.ctaLabel")}
          </Link>
        }
      />
    );
  }

  const popularArticles = await popularArticlesPromise;

  // A7: 記事が 1 件しかないときに特集へ吸い上げると、一覧グリッドが空になり
  // 「記事がありません」が出ていた (実際には 1 件あるのに)。総件数が 1 なら
  // 特集枠は出さず、その 1 件をグリッドに出す。
  const canFeature = showsFeatured && (total ?? 0) > 1;
  const featured = canFeature
    ? ((featuredArticles ?? [])[0] ?? (newestArticles ?? [])[0])
    : undefined;

  // 3) 一覧本体。特集に使った 1 件は一覧から落とす。
  const filtered = (windowArticles ?? []).filter((a) => a._id !== featured?._id);

  // 並び替え。既定 (おすすめ順) のときだけパーソナライズを通す。
  // 新着順・古い順は Sanity 側で並べてから切り出しているので、ここでは触らない。
  let ordered = filtered;
  if (sort === "recommended") {
    // ログイン判定は冒頭で投げてあるので、ここでは既に返っている
    // (未ログイン・失敗はどちらも null に倒れる)。
    const customerId = await customerIdPromise;
    ordered = await getRecommendedArticles({ customerId, rawArticles: filtered });
  }

  const visible = ordered.slice(0, show);
  // 残件は「取得した窓」ではなく総件数から出す。窓で判断すると窓の外の記事に
  // 永久に到達できない (= 従来の 60 件上限)。
  const remaining = Math.max(0, (total ?? 0) - (featured ? 1 : 0) - visible.length);

  const query = (extra: Record<string, string>) => {
    const usp = new URLSearchParams();
    if (activeCategory !== "all") usp.set("category", activeCategory);
    if (sort !== "recommended") usp.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) usp.set(k, v);
    const qs = usp.toString();
    return qs ? `/journal?${qs}` : "/journal";
  };

  // サイドバー「人気の記事」(A10)。行動ログ (Firestore) の閲覧数を集計して
  // 実際に読まれた順に並べる。実データが薄い / 取得できないときは従来どおり
  // 「特集記事が先・残りは新しい順」に倒す (getPopularArticles は投げない)。
  // 一覧の取得窓とは独立に引いているので、絞り込み中もサイト全体の並びを保つ。
  const railSeen = new Set<string>();
  const railCandidates = [...(featuredArticles ?? []), ...(newestArticles ?? [])].filter((a) => {
    if (!a?.slug?.current || railSeen.has(a._id)) return false;
    railSeen.add(a._id);
    return true;
  });
  const railPopular = orderByPopularity(railCandidates, popularArticles)
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
            formatArticleDate(featured.publishedAt) || null,
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
          <div className="order-1">
            {/* 絞り込みの結果として 0 件。障害 (loadError) とは必ず出し分ける
                — こちらは再試行ではなく絞り込みの解除を促す
                (Figma EmptyState 8173:298 の注記)。 */}
            <EmptyState
              icon={FilterX}
              count={t("emptyFiltered.eyebrow")}
              title={t("emptyFiltered.title")}
              body={t("emptyFiltered.body")}
              action={
                <Link href="/journal" className={pillClass("outline")}>
                  {t("emptyFiltered.ctaLabel")}
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
            className="order-2 lg:col-span-2"
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
