import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import { TEA_MENUS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
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
  category: string;
  variety: string;
  origin: string;
  color?: string;
};

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
      <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: t("title") }]} />

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
  try {
    const client = getClient();
    items = (await client.fetch(TEA_MENUS_QUERY, { language: locale })) ?? [];
  } catch {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>;
  }

  if (items.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("empty")}</p>;
  }

  // チップは実データの category から組む (Figma の固定文言は焼かない)。
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];
  const chips = [
    { value: "all", label: tl("all") },
    ...categories.map((c) => ({ value: c, label: c })),
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
    label: category,
    count: items.filter((item) => item.category === category).length,
    href: `/tea-menu?category=${encodeURIComponent(category)}`,
  }));

  return (
    <>
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
            overline={item.category}
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
