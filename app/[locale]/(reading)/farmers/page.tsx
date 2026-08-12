import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import { FARMERS_QUERY } from "@/sanity/lib/queries";
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
import { filterOutFictionalFarmers } from "@/lib/fictional-farmers";
import { isSeedId, withSeedFarmers } from "@/lib/preview-seed";

/**
 * 農家一覧 — Figma【R2: 確定版】共通リストパターンの実装。
 *
 * ## この画面に R2 確定版フレームが無いことの扱い (C9-1 の判断)
 * Structure List「農家一覧」(https://app.notion.com/33270c9d064c81e089dff5ab464cce55)
 * の `ステータス：Design` は **Not started** で、`Figma` プロパティが指す
 * `6639:7029` は R1 世代の「農家一覧 変A（部品ベース）」だった。R2 確定版セクションを
 * 3 ページ (7567:2 EC / 7567:4 Journal / 7567:6 Event) 全数走査しても農家一覧は無い。
 *
 * よって**確定済みの兄弟テンプレから導出**する:
 * - 構造の正本 = 共通リストパターン お茶メニュー一覧 PC `8063:2144` / SP `8063:2372`
 *   (商品一覧 PC `8061:1781` / SP `8062:2008` と同一骨格)
 * - 内容モデルの正本 = 変A `6639:7029` (FarmerCard = 写真 + 氏名 + 産地)
 *
 * 部品は `components/catalog/catalog-list.tsx` を丸ごと共有するので、寸法・文字組み・
 * 色は商品一覧 / お茶メニュー一覧と 1 px も違わない。本ファイルに生 px は書かない。
 *
 * 差分は 3 点だけ:
 * 1. 英字キッカーが `FARMERS`
 * 2. フィルタ軸が category ではなく **産地 (region)**
 * 3. カードの meta 行を持たない (氏名 + 産地の 2 行 = 変A FarmerCard と同じ)
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("farmer");
  // en の lead は未入稿 (空文字) なので description には載せない。
  const lead = t("lead") || undefined;
  return {
    title: t("heading"),
    description: lead,
    openGraph: {
      title: t("heading"),
      description: lead,
    },
  };
}

/** Figma の共通リストパターンは 3 列 x 4 段 = 12 件を初期表示する (8063:2169)。 */
const PAGE_SIZE = 12;

type Farmer = {
  _id: string;
  name: string;
  slug: { current: string };
  imageUrl?: string;
  photo?: { asset: object; alt?: string };
  region?: string;
  country?: string;
};

type SearchParams = { region?: string; show?: string };

/** 産地の表示単位。region が空なら country に落とす (どちらも無ければ未分類)。 */
function regionOf(farmer: Farmer): string {
  return farmer.region || farmer.country || "";
}

export default async function FarmersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getTranslations("farmer");
  const tc = await getTranslations("common");
  const bt = await getTranslations("breadcrumb");

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      {/* パンくず → PageHead は Figma PC 48 (R2 共通リストパターン)。既定
          `mb-8` (32) は共有部品なので変えず、R2 リスト 3 画面だけ PC を 48 に
          する (商品一覧と同じ扱い・C9-1 注2)。 */}
      <Breadcrumb
        className="lg:mb-12"
        items={[{ label: bt("home"), href: "/" }, { label: tc("farmers") }]}
      />

      <ListPageHead overline="FARMERS" title={t("heading")} lead={t("lead")} />

      <FarmersList params={params} />
    </Section>
  );
}

async function FarmersList({ params }: { params: SearchParams }) {
  const locale = await getLocale();
  const t = await getTranslations("farmer");
  const tl = await getTranslations("catalog");

  let fetched: Farmer[];
  try {
    const client = getClient();
    fetched = (await client.fetch(FARMERS_QUERY, { language: locale })) ?? [];
  } catch {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>;
  }

  // 承認前の架空プロフィールは production dataset に残っていても出さない
  // (コードのみの除外・Sanity への書き戻しはしない)。
  const real = filterOutFictionalFarmers(fetched);

  // Preview 限定: 実データは写真が無く件数も薄いので、見本の写真を当てて
  // グリッドを埋める。フラグ未設定時は入力をそのまま返す。
  // 14 件にするのは計測のため — 初期表示 12 件 (Figma 3 列 x 4 段) を満たしたうえで
  // 残 2 件が出るので `MoreRow` も実寸計測できる (既定 6 件では MoreRow が出ない)。
  const farmers = withSeedFarmers(real, 14) as Farmer[];

  if (farmers.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("empty")}</p>;
  }

  // チップは実データの産地から組む (Figma の固定文言は焼かない)。
  const regions = [...new Set(farmers.map(regionOf).filter(Boolean))];
  const chips = [
    { value: "all", label: tl("all") },
    ...regions.map((r) => ({ value: r, label: r })),
  ];

  const activeRegion =
    params.region && regions.includes(params.region) ? params.region : "all";
  const filtered =
    activeRegion === "all"
      ? farmers
      : farmers.filter((farmer) => regionOf(farmer) === activeRegion);

  const show = Math.max(PAGE_SIZE, Number(params.show) || PAGE_SIZE);
  const visible = filtered.slice(0, show);
  const remaining = filtered.length - visible.length;

  const moreHref = () => {
    const usp = new URLSearchParams();
    if (activeRegion !== "all") usp.set("region", activeRegion);
    usp.set("show", String(show + PAGE_SIZE));
    return `/farmers?${usp.toString()}`;
  };

  const kindEntries = regions.map((region) => ({
    label: region,
    count: farmers.filter((farmer) => regionOf(farmer) === region).length,
    href: `/farmers?region=${encodeURIComponent(region)}`,
  }));

  return (
    <>
      <CatalogToolbar
        className="mt-8 lg:mt-12"
        chips={chips}
        activeChip={activeRegion}
        chipParam="region"
        sortLabel={tl("sortLabel")}
      />

      <CatalogGrid className="mt-8 lg:mt-12">
        {visible.map((farmer) => {
          // 見本カード (`seed-farmer-N`) は詳細ドキュメントが無く
          // `/ja/farmers/[slug]` が notFound になるので、リンクを張らない。
          const seeded = isSeedId(farmer._id);
          const image =
            farmer.imageUrl ??
            (farmer.photo?.asset
              ? urlFor(farmer.photo).width(600).height(400).url()
              : undefined);

          return (
            <CatalogCard
              key={farmer._id}
              href={seeded ? undefined : `/farmers/${farmer.slug.current}`}
              image={image}
              imageAlt={farmer.photo?.alt || farmer.name}
              overline={regionOf(farmer) || undefined}
              title={farmer.name}
            />
          );
        })}
      </CatalogGrid>

      <KindIndex className="mt-8" title={t("byRegion")} entries={kindEntries} />

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
