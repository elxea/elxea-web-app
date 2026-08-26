import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { FilterX } from "lucide-react";

import { getCollectionProductHandles, getCollections, getProducts } from "@/lib/shopify";
import { productTypeLabel } from "@/lib/shopify/product-type";
import {
  categoryFilterValue,
  resolveCategoryFilter,
  type CategoryFilter,
} from "@/lib/shopify/category-filter";
import type { Product } from "@/lib/shopify/types";
import { Link } from "@/i18n/navigation";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { pillClass } from "@/components/ui/pill-button";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import {
  CatalogGrid,
  KindIndex,
  ListPageHead,
  MoreRow,
} from "@/components/catalog/catalog-list";
import { ProductCard } from "@/components/product/product-card";

/**
 * 商品一覧 — Figma【R2: 確定版】共通リストパターン
 * (PC 8061:1781 / SP 8062:2008) の実装。
 *
 * 構成: Breadcrumb → PageHead (英字キッカー + 日本語見出し + リード) →
 * Toolbar (ピル型チップ + 並び替え) → Grid (SP 2列 / PC 3列) →
 * 種類から探す (SP のみ) → もっと見る。骨格部品は
 * `components/catalog/catalog-list.tsx` に共有 (お茶メニューと同一)。
 *
 * 絞り込み (`?category=`) / 並び替え (`?sort=`) / 表示件数 (`?show=`) は
 * URL に載せる。Figma のチップ文言は Shopify の productType から動的に組む
 * (固定文言をコードに焼かない)。
 */

export const metadata: Metadata = {
  title: "Products",
  description: "日本各地の小規模茶農家から厳選した、シングルオリジン茶葉のクラフトティー。",
};

/** Figma ProductGrid は 3 列 x 4 段 = 12 件を初期表示する (8061:1806)。 */
const PAGE_SIZE = 12;

const SORT_KEYS: Record<string, { sortKey: string; reverse: boolean }> = {
  newest: { sortKey: "CREATED_AT", reverse: true },
  priceAsc: { sortKey: "PRICE", reverse: false },
  priceDesc: { sortKey: "PRICE", reverse: true },
};

type SearchParams = { category?: string; sort?: string; show?: string };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getTranslations("product");
  const tc = await getTranslations("common");
  const bt = await getTranslations("breadcrumb");

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      {/* パンくず → PageHead は Figma PC 48 (R2 共通リストパターン)。共有
          `Breadcrumb` の既定 `mb-8` (32) は他 10 ページ超が使うので変えず、
          R2 リスト 3 画面 (商品一覧 / お茶メニュー一覧 / 農家一覧) だけ PC を
          48 にする。SP は Figma フレームにパンくずが無いので 32 を維持。
          C9-1 注2 の 16px 差を閉じる。 */}
      <Breadcrumb
        className="lg:mb-12"
        items={[{ label: bt("home"), href: "/" }, { label: tc("products") }]}
      />

      <ListPageHead
        overline="ALL PRODUCTS"
        title={tc("products")}
        lead={t("listLead")}
      />

      <ProductsContent params={params} />
    </Section>
  );
}

async function ProductsContent({ params }: { params: SearchParams }) {
  const t = await getTranslations("product");
  const tl = await getTranslations("catalog");
  const locale = await getLocale();

  const sort = params.sort && params.sort in SORT_KEYS ? params.sort : "newest";

  let products: Product[];
  try {
    ({ products } = await getProducts({ first: 60, ...SORT_KEYS[sort] }));
  } catch {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>;
  }

  /* チップは実データの productType から組む (Figma の固定文言は焼かない)。
     **値** は生の productType (`Green Tea｜緑茶`) のまま URL に載せ、**ラベル**
     だけロケール側 (`緑茶`) に落とす。日本語 UI に英日併記のラベルが出るのを
     やめるための分離で、分類名そのものはコードに持たない。 */
  const categories = [...new Set(products.map((p) => p.productType).filter(Boolean))];

  /* `?category=` は生の productType だけでなく、トップの CATEGORIES タイル /
     コレクション一覧が渡す**コレクション名** (`お茶のアソートセット`) でも届く。
     コレクション名は productType にまたがることがあり、旧実装ではそれが黙って
     「すべて」に落ちて 12 件が全部出ていた (通しテスト E-3)。判断は
     `resolveCategoryFilter` が正本。コレクションだったときだけ所属 handle を
     引いて絞る (productType で済むときは追加の往復をしない)。 */
  const resolved = await resolveCategory(params.category, categories);
  const { filter } = resolved;
  const activeCategory = categoryFilterValue(filter);

  /* コレクション絞り込みのときは、そのコレクション名のチップを 1 枚足す。
     足さないと「すべて」が選択状態のまま件数だけ減り、何で絞られているのかも
     解除の仕方も画面から分からない。 */
  const chips = [
    { value: "all", label: tl("all") },
    ...categories.map((c) => ({ value: c, label: productTypeLabel(c, locale) })),
    ...(filter.kind === "collection"
      ? [{ value: filter.title, label: filter.title }]
      : []),
  ];

  const filtered = filterProducts(products, resolved);

  const show = Math.max(PAGE_SIZE, Number(params.show) || PAGE_SIZE);
  const visible = filtered.slice(0, show);
  const remaining = filtered.length - visible.length;

  const query = (extra: Record<string, string>) => {
    const usp = new URLSearchParams();
    if (activeCategory !== "all") usp.set("category", activeCategory);
    if (sort !== "newest") usp.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) usp.set(k, v);
    const qs = usp.toString();
    return qs ? `/products?${qs}` : "/products";
  };

  const kindEntries = categories.map((category) => ({
    label: productTypeLabel(category, locale),
    count: products.filter((p) => p.productType === category).length,
    href: `/products?category=${encodeURIComponent(category)}`,
  }));

  return (
    <>
      <CatalogToolbar
        className="mt-8 lg:mt-12"
        chips={chips}
        activeChip={activeCategory}
        activeSort={sort}
        sortLabel={tl("sortLabel")}
        sortOptions={[
          { value: "newest", label: tl("sortNewest") },
          { value: "priceAsc", label: tl("sortPriceAsc") },
          { value: "priceDesc", label: tl("sortPriceDesc") },
        ]}
      />

      {visible.length === 0 ? (
        /* P2 絞り込みの結果として 0 件。障害 (loadError) とは必ず出し分ける
           — こちらは再試行ではなく絞り込みの解除を促す。在庫・取扱の話なので
           文言に「まだ」は付けない (Figma 8272:4460 の注記)。解除できる絞り込みが
           無いとき (取扱そのものが 0 件) は押せない導線を出さない。 */
        <EmptyState
          className="mt-8 lg:mt-12"
          icon={FilterX}
          count={t("noProductsFiltered.eyebrow")}
          title={t("noProductsFiltered.title")}
          body={t("noProductsFiltered.body")}
          action={
            activeCategory === "all" ? undefined : (
              <Link href="/products" className={pillClass("outline")}>
                {t("noProductsFiltered.ctaLabel")}
              </Link>
            )
          }
        />
      ) : (
        <CatalogGrid className="mt-8 lg:mt-12">
          {visible.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </CatalogGrid>
      )}

      <KindIndex className="mt-8" title={tl("byKind")} entries={kindEntries} />

      {remaining > 0 ? (
        <MoreRow
          className="mt-8 lg:mt-12"
          href={query({ show: String(show + PAGE_SIZE) })}
          label={tl("showMore", { count: Math.min(remaining, PAGE_SIZE) })}
        />
      ) : null}
    </>
  );
}

type ResolvedCategory = {
  filter: CategoryFilter;
  /** コレクション絞り込みのときだけ入る所属 handle。 */
  memberHandles: ReadonlySet<string> | null;
};

/**
 * `?category=` を実際に効く絞り込みへ解決する。
 *
 * コレクション一覧を引くのは **productType で拾えなかったときだけ**。緑茶 /
 * 紅茶 / 烏龍茶のチップ経由 (大半の導線) では往復が 1 回も増えない。
 *
 * コレクション側の取得に失敗しても画面は落とさない — 絞り込みなしに落として
 * 一覧を出す (取得失敗を 0 件表示と混同させない)。
 */
async function resolveCategory(
  requested: string | undefined,
  productTypes: readonly string[],
): Promise<ResolvedCategory> {
  const byProductType = resolveCategoryFilter(requested, productTypes);
  if (byProductType.kind !== "all" || !requested?.trim()) {
    return { filter: byProductType, memberHandles: null };
  }

  try {
    const collections = await getCollections(50);
    const filter = resolveCategoryFilter(requested, productTypes, collections);
    if (filter.kind !== "collection") return { filter, memberHandles: null };

    const handles = await getCollectionProductHandles(filter.handle);
    /* 所属が 1 件も取れないなら絞り込みとして採用しない。採用すると「押したら
       0 件」になり、壊れているのと見分けが付かない。 */
    if (handles.length === 0) return { filter: { kind: "all" }, memberHandles: null };
    return { filter, memberHandles: new Set(handles) };
  } catch {
    return { filter: { kind: "all" }, memberHandles: null };
  }
}

function filterProducts(
  products: readonly Product[],
  { filter, memberHandles }: ResolvedCategory,
): Product[] {
  switch (filter.kind) {
    case "productType":
      return products.filter((p) => p.productType === filter.value);
    case "collection":
      return products.filter((p) => memberHandles?.has(p.handle) ?? false);
    default:
      return [...products];
  }
}
