import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { Sprout } from "lucide-react";

import { sanityFetch } from "@/sanity/lib/fetch";
import { CATEGORY_LABELS_QUERY, TEA_MENUS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Link } from "@/i18n/navigation";
import { filterOutFictional } from "@/lib/fictional-content";
import { EmptyState } from "@/components/ui/empty-state";
import { pillClass } from "@/components/ui/pill-button";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import { TerroirOverviewBlock } from "@/components/viz/terroir/terroir-overview-block";
import {
  CatalogCard,
  CatalogGrid,
  KindIndex,
  ListPageHead,
  MoreRow,
} from "@/components/catalog/catalog-list";

/**
 * お茶メニュー — Figma【R2: 確定版】共通リストパターン
 * (PC 8063:2144 / SP 8063:2372) の実装。
 *
 * 商品一覧 (8061:1781 / 8062:2008) と同一骨格。差分は「英字キッカーが
 * TEA MENU」「カテゴリが Sanity の category」「価格の代わりに 品種 · 産地」
 * の 3 点だけなので、部品は `components/catalog/catalog-list.tsx` を共有する。
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("teaMenu");
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      title: t("title"),
      description: t("description"),
    },
  };
}

/** Figma ProductGrid は 3 列 x 4 段 = 12 件を初期表示する (8063:2169)。 */
const PAGE_SIZE = 12;

type TeaMenuItem = {
  _id: string;
  slug: { current: string };
  photo?: { asset: object; alt?: string };
  displayName: string;
  /** 銘柄番号。5 桁採番なら産地の実測座標が引ける (テロワール地図の入力)。 */
  productNumber?: string | number | null;
  category: string;
  variety: string;
  origin: string;
  color?: string;
};

/** カテゴリ表示名 (Sanity `category` ドキュメント)。中身は CMS の役割。 */
type CategoryLabel = { slug?: string; title?: string; displayName?: string };

type SearchParams = { category?: string; sort?: string; show?: string };

export default async function TeaMenuPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getTranslations("teaMenu");
  const bt = await getTranslations("breadcrumb");

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      {/* パンくず → PageHead は Figma PC 48 (R2 共通リストパターン)。既定
          `mb-8` (32) は共有部品なので変えず、R2 リスト 3 画面だけ PC を 48 に
          する (商品一覧と同じ扱い・C9-1 注2)。 */}
      <Breadcrumb
        className="lg:mb-12"
        items={[{ label: bt("home"), href: "/" }, { label: t("title") }]}
      />

      <ListPageHead overline="TEA MENU" title={t("title")} lead={t("description")} />

      <TeaMenuList params={params} />
    </Section>
  );
}

async function TeaMenuList({ params }: { params: SearchParams }) {
  const locale = await getLocale();
  const t = await getTranslations("teaMenu");
  const tl = await getTranslations("catalog");

  let items: TeaMenuItem[];
  let categoryLabels: CategoryLabel[] = [];
  try {
    // 本番データセットに残っている架空・シードのお茶メニューは読み取り層で落とす
    // (#66 / Sanity は変更しない)。空になったときの出口は下の EmptyState が担う。
    items = filterOutFictional(
      "teaMenu",
      (await sanityFetch<TeaMenuItem[]>({
        query: TEA_MENUS_QUERY,
        params: { language: locale },
        cache: { tag: "sanity:tea-menus" },
      })) ?? []
    );
    // 表示名は CMS 側の正本を引く。取得に失敗しても一覧は出す (生値で退避)。
    categoryLabels =
      (await sanityFetch<CategoryLabel[]>({
        query: CATEGORY_LABELS_QUERY,
        cache: { tag: "sanity:categories" },
      }).catch(() => [])) ?? [];
  } catch {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>;
  }

  if (items.length === 0) {
    /* P1 一覧そのものが空。障害 (loadError) とは必ず出し分ける — 再試行では
       なく横に抜ける出口 (商品一覧) を出す。 */
    return (
      <EmptyState
        className="mt-8 lg:mt-12"
        icon={Sprout}
        count={t("empty.eyebrow")}
        title={t("empty.title")}
        body={t("empty.body")}
        action={
          <Link href="/products" className={pillClass("outline")}>
            {t("empty.ctaLabel")}
          </Link>
        }
      />
    );
  }

  // チップは実データの category から組む (Figma の固定文言は焼かない)。
  // ラベルは Sanity `category.displayName` を正本にする (Boss 裁定 2026-08-08:
  // 見た目 = コード / 中身 = CMS)。表示名が無いカテゴリは生値のまま出す。
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];
  const labelOf = (value: string) => {
    const match = categoryLabels.find((c) => c.slug === value || c.title === value);
    return match?.displayName || value;
  };
  const chips = [
    { value: "all", label: tl("all") },
    ...categories.map((c) => ({ value: c, label: labelOf(c) })),
  ];

  const activeCategory =
    params.category && categories.includes(params.category) ? params.category : "all";
  const filtered =
    activeCategory === "all"
      ? items
      : items.filter((item) => item.category === activeCategory);

  const show = Math.max(PAGE_SIZE, Number(params.show) || PAGE_SIZE);
  const visible = filtered.slice(0, show);
  const remaining = filtered.length - visible.length;

  const moreHref = () => {
    const usp = new URLSearchParams();
    if (activeCategory !== "all") usp.set("category", activeCategory);
    usp.set("show", String(show + PAGE_SIZE));
    return `/tea-menu?${usp.toString()}`;
  };

  const kindEntries = categories.map((category) => ({
    label: labelOf(category),
    count: items.filter((item) => item.category === category).length,
    href: `/tea-menu?category=${encodeURIComponent(category)}`,
  }));

  return (
    <>
      {/* テロワール地図 — いま一覧に出ているお茶の産地を 1 枚に置く。
          表示中の産地が全部収まる尺度に自動で合わせるので、上のカテゴリー
          チップで絞り込むと画角もそれに追従する (単品詳細の「土地を読む」は
          産地ごとの固定尺度のままで、そちらは変えていない)。
          点の色はお茶のカテゴリー — `docs/roji-dataviz-rules.md`。
          座標が 1 件も引けないときはブロックごと出ない。 */}
      <TerroirOverviewBlock
        className="mt-8 lg:mt-12"
        items={visible.map((item) => ({
          id: item._id,
          menuNumber: item.productNumber,
          origin: item.origin,
          category: item.category,
        }))}
        label={t("originsMapAlt")}
      />

      <CatalogToolbar
        className="mt-8 lg:mt-12"
        chips={chips}
        activeChip={activeCategory}
        sortLabel={tl("sortLabel")}
      />

      <CatalogGrid className="mt-8 lg:mt-12">
        {visible.map((item) => (
          <CatalogCard
            key={item._id}
            href={`/tea-menu/${item.slug.current}`}
            image={
              item.photo?.asset ? urlFor(item.photo).width(600).height(400).url() : undefined
            }
            imageAlt={item.photo?.alt || item.displayName}
            imageStyle={item.color ? { backgroundColor: item.color } : undefined}
            overline={labelOf(item.category)}
            title={item.displayName}
            meta={`${item.variety} · ${item.origin}`}
          />
        ))}
      </CatalogGrid>

      <KindIndex className="mt-8" title={tl("byKind")} entries={kindEntries} />

      {remaining > 0 ? (
        <MoreRow
          className="mt-8 lg:mt-12"
          href={moreHref()}
          label={tl("showMore", { count: Math.min(remaining, PAGE_SIZE) })}
        />
      ) : null}
    </>
  );
}
