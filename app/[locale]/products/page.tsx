import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getProducts } from "@/lib/shopify";
import type { Product } from "@/lib/shopify/types";
import { Breadcrumb } from "@/components/seo/breadcrumb";
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
      <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: tc("products") }]} />

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

  const sort = params.sort && params.sort in SORT_KEYS ? params.sort : "newest";

  let products: Product[];
  try {
    ({ products } = await getProducts({ first: 60, ...SORT_KEYS[sort] }));
  } catch {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>;
  }

  // チップは実データの productType から組む (Figma の固定文言は焼かない)。
  const categories = [...new Set(products.map((p) => p.productType).filter(Boolean))];
  const chips = [
    { value: "all", label: tl("all") },
    ...categories.map((c) => ({ value: c, label: c })),
  ];

  const activeCategory =
    params.category && categories.includes(params.category) ? params.category : "all";
  const filtered =
    activeCategory === "all"
      ? products
      : products.filter((p) => p.productType === activeCategory);

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
    label: category,
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
        <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("noProducts")}</p>
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
