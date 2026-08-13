import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Sprout } from "lucide-react";

import { decodeHandle } from "@/lib/handle";
import { getCollectionByHandle } from "@/lib/shopify";
import { Link } from "@/i18n/navigation";
import { Section } from "@/components/layout/container";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { pillClass } from "@/components/ui/pill-button";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import {
  CatalogGrid,
  ListPageHead,
  MoreRow,
} from "@/components/catalog/catalog-list";
import { ProductCard } from "@/components/product/product-card";

/**
 * コレクション詳細 — Figma【R2: 確定版】共通リストパターン
 * (商品一覧 PC 8061:1781 / SP 8062:2008、お茶メニュー一覧 PC 8063:2144 /
 * SP 8063:2372) の実装。
 *
 * ## SoT の所在 (2026-08-09 全数走査で確定)
 * この画面の roji 世代デザインは Figma に**存在しない**。全 14 ページ
 * (Foundations / elxea Proposals / roji 7567:2〜13) を走査した結果、
 * 「コレクション詳細」を名前に含むノードは旧 elxea 変A `6647:7525`
 * (`コレクション詳細 変A（部品ベース）— PC/SP @/ja/collections/[handle]`、
 * page 6054:15 = elxea / Proposals) の 1 件のみで、`【R2: 確定版】` も
 * `【採用】` 凍結も無い。Structure DB の `Figma` プロパティはこの変A を
 * 指しており stale (同種の stale は本 PJ で 4 件目)。
 *
 * よって C9-1 の先例に従い**デザインを発明せず、凍結済みの兄弟 R2 テンプレから
 * 導出**する。導出元は EC 系で凍結済みの「共通リストパターン」:
 * コレクション詳細は「あるコレクションに属する商品の一覧」であり、一覧系 3 画面
 * (商品一覧 / お茶メニュー一覧 / コレクション一覧) と同じ型に完全に収まる。
 * `components/catalog/catalog-list.tsx` の `ListPageHead` の実装注記が
 * 「同じ R2 パターン配下の詳細ページ (collections/[handle]・elxea-journal) と
 * 同一実装になる」と既に宣言しており、その前提と整合する。
 *
 * ## 商品一覧との差分は 3 点だけ
 * - 英字キッカーが COLLECTION、見出しがコレクション名、リードがコレクション説明
 * - **チップ列を持たない**。コレクション自体が絞り込みの結果なので二重の facet に
 *   なる。Toolbar は並び替え Select のみを出す (Figma の Toolbar は
 *   「Chips + Select」だが、Chips が空のときは Select だけが残る既存挙動)
 * - `KindIndex` (種類から探す) を置かない。コレクション内に下位の種類軸が無い
 *
 * ## 並び替えは Shopify の ProductCollectionSortKeys に載せる
 * 既定は `BEST_SELLING` (= 商品一覧の `CREATED_AT` 新着順とは別。コレクションは
 * 店側の意図した並びが既定であるべきなので「おすすめ順」を初期値にする)。
 * `?sort=` / `?show=` を URL に載せ、SSR / 戻る / 共有で同じ結果になるようにする。
 */

/** Figma ProductGrid は 3 列 x 4 段 = 12 件を初期表示する (8061:1806)。 */
const PAGE_SIZE = 12;

/**
 * Shopify の `ProductCollectionSortKeys` は商品一覧の `ProductSortKeys` と
 * 別の enum で、`CREATED_AT` ではなく `CREATED` を取る。商品一覧の
 * `SORT_KEYS` をそのまま流用すると GraphQL エラーになるためここで別に持つ。
 */
const SORT_KEYS: Record<string, { sortKey: string; reverse: boolean }> = {
  recommended: { sortKey: "BEST_SELLING", reverse: false },
  newest: { sortKey: "CREATED", reverse: true },
  priceAsc: { sortKey: "PRICE", reverse: false },
  priceDesc: { sortKey: "PRICE", reverse: true },
};

type SearchParams = { sort?: string; show?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle: rawHandle } = await params;
  const handle = decodeHandle(rawHandle);
  try {
    const collection = await getCollectionByHandle(handle);
    if (!collection) return {};
    const description =
      collection.seo.description || collection.description?.slice(0, 160);
    return {
      title: collection.title,
      description,
      openGraph: {
        title: collection.title,
        description,
        images: collection.image ? [{ url: collection.image.url }] : [],
      },
    };
  } catch {
    return {};
  }
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { handle: rawHandle } = await params;
  const handle = decodeHandle(rawHandle);
  const sp = await searchParams;

  const t = await getTranslations("collection");
  const tl = await getTranslations("catalog");
  const tc = await getTranslations("common");
  const bt = await getTranslations("breadcrumb");

  const sort = sp.sort && sp.sort in SORT_KEYS ? sp.sort : "recommended";

  // 一覧パターンの Grid は初期 12 件。`?show=` を増やして追加読み込みするので
  // 上限に余裕を持たせて 1 回で引く (商品一覧と同じ 60 件)。
  let collection;
  try {
    collection = await getCollectionByHandle(handle, {
      first: 60,
      ...SORT_KEYS[sort],
    });
  } catch {
    return (
      <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      </Section>
    );
  }

  if (!collection) notFound();

  const products = collection.products;
  const show = Math.max(PAGE_SIZE, Number(sp.show) || PAGE_SIZE);
  const visible = products.slice(0, show);
  const remaining = products.length - visible.length;

  const moreHref = () => {
    const usp = new URLSearchParams();
    if (sort !== "recommended") usp.set("sort", sort);
    usp.set("show", String(show + PAGE_SIZE));
    return `/collections/${rawHandle}?${usp.toString()}`;
  };

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: tc("collections"), href: "/collections" },
          { label: collection.title },
        ]}
      />

      <ListPageHead
        overline="COLLECTION"
        title={collection.title}
        /* データが無い節・行は出さない方針。説明が空ならリード行ごと出さない。 */
        lead={collection.description || undefined}
      />

      {/* チップは渡さない (コレクション自体が絞り込み結果)。並び替えのみ。 */}
      <CatalogToolbar
        className="mt-8 lg:mt-12"
        chips={[]}
        activeSort={sort}
        sortLabel={tl("sortLabel")}
        sortOptions={[
          { value: "recommended", label: tl("sortRecommended") },
          { value: "newest", label: tl("sortNewest") },
          { value: "priceAsc", label: tl("sortPriceAsc") },
          { value: "priceDesc", label: tl("sortPriceDesc") },
        ]}
      />

      {visible.length === 0 ? (
        /* P3 URL 自体がスコープ (このコレクション) で、その中身が 0 件。解除
           できる絞り込みではないので、導線は親一覧 (コレクション一覧) へ戻す。
           障害 (loadError) とは必ず出し分ける。 */
        <EmptyState
          className="mt-8 lg:mt-12"
          icon={Sprout}
          count={t("emptyProducts.eyebrow")}
          title={t("emptyProducts.title")}
          body={t("emptyProducts.body")}
          action={
            <Link href="/collections" className={pillClass("outline")}>
              {t("emptyProducts.ctaLabel")}
            </Link>
          }
        />
      ) : (
        <CatalogGrid className="mt-8 lg:mt-12">
          {visible.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </CatalogGrid>
      )}

      {remaining > 0 ? (
        <MoreRow
          className="mt-8 lg:mt-12"
          href={moreHref()}
          label={tl("showMore", { count: Math.min(remaining, PAGE_SIZE) })}
        />
      ) : null}
    </Section>
  );
}
