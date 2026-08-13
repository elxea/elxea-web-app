import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Sprout } from "lucide-react";

import { getCollections } from "@/lib/shopify";
import { Link } from "@/i18n/navigation";
import { Section } from "@/components/layout/container";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { EmptyState } from "@/components/ui/empty-state";
import { pillClass } from "@/components/ui/pill-button";
import { CatalogCard, CatalogGrid, ListPageHead } from "@/components/catalog/catalog-list";

/**
 * コレクション一覧 — Figma【R2: 確定版】共通リストパターン
 * (商品一覧 PC 8061:1781 / SP 8062:2008、お茶メニュー PC 8063:2144 / SP 8063:2372)
 * の実装。
 *
 * SoT の所在 (2026-08-08 実測): EC / Proposals ページ (7567:2) の
 * section「【要修正】 コレクション一覧」7753:981 は中身が申告テキスト
 * (7876:4521) だけで、専用のレイアウト案フレームを持たない。一覧系 3 ページ
 * (商品一覧 / お茶メニュー / コレクション一覧) は R2 で「共通リストパターン」に
 * 統一する決定なので、コレクション一覧もその確定版に合わせ、部品は
 * `components/catalog/catalog-list.tsx` を共有する。
 *
 * 差分は 3 点だけ:
 * - 英字キッカーが COLLECTIONS
 * - カードのキッカーを持たない (コレクションに上位カテゴリが無いため)
 * - meta 行がコレクション説明の 1 行 (価格・品種の代わり)
 *
 * カテゴリ facet が無いので CatalogToolbar / KindIndex / MoreRow は置かない
 * (Shopify の collections は既定 20 件で 1 画面に収まる)。
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("collections"),
    openGraph: { title: t("collections") },
  };
}

export default async function CollectionsPage() {
  const t = await getTranslations("common");
  const bt = await getTranslations("breadcrumb");

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: t("collections") }]} />

      <ListPageHead overline="COLLECTIONS" title={t("collections")} />

      <CollectionsContent />
    </Section>
  );
}

async function CollectionsContent() {
  const t = await getTranslations("collection");

  let collections;
  try {
    collections = await getCollections();
  } catch {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>;
  }

  if (collections.length === 0) {
    /* P1 一覧そのものが空。障害 (loadError) とは必ず出し分ける — 再試行では
       なく横に抜ける出口 (商品一覧) を出す (Figma 8272:4460 の注記)。 */
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

  return (
    <CatalogGrid className="mt-8 lg:mt-12">
      {collections.map((collection) => (
        <CatalogCard
          key={collection.id}
          href={`/collections/${collection.handle}`}
          image={collection.image?.url}
          imageAlt={collection.image?.altText || collection.title}
          title={collection.title}
          /* 一覧クエリ (GET_COLLECTIONS_QUERY) は products を引かないので件数は
             出せない。meta 行はコレクション説明の 1 行に充てる。 */
          meta={
            collection.description ? (
              <span className="line-clamp-1">{collection.description}</span>
            ) : undefined
          }
        />
      ))}
    </CatalogGrid>
  );
}
