import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getClient } from "@/sanity/lib/client";
import { JOURNALS_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Section } from "@/components/layout/container";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { ListPageHead } from "@/components/catalog/catalog-list";
import { CatalogGrid } from "@/components/catalog/catalog-list";
import { ImageCard } from "@/components/ui/image-card";
import { ThemeBadge } from "@/components/set-edition/theme";
import { bodySmClass, captionClass } from "@/components/editorial/rule-list";
import { previewSeedEnabled, previewImageForKey, withSeedJournals } from "@/lib/preview-seed";
import { cn } from "@/lib/utils";

/**
 * Set Edition 一覧 (`/elxea-journal`) — C3 の DS 移行。
 *
 * 呼称 (Setaka 2026-08-11 確定): roji の読み物の総称が「elxea Journal」で、
 * その 2 種類が Personal Edition (会員・動的) と Set Edition (買い切り・
 * プリセット)。このページは Set Edition。以前のキッカーは "Newsletter" だったが
 * 「ニュースレター」は廃語なので "SET EDITION" に寄せる。URL は互換のため据え置き。
 *
 * DS 移行の中身 (新規部品は作らない — 既存 DS と重複させない):
 * - 外枠           `section-wide py-20 md:px-20` の手組み → `Section`
 * - 見出し         生 px のキッカー + h1 + リード → `ListPageHead`
 * - パンくず       無し → `Breadcrumb` (他の一覧ページと同じ導線)
 * - グリッド       手組み 3 列 → `CatalogGrid` (商品一覧・お茶メニューと同じ)
 * - テーマバッジ   ページ内の重複定数 → `components/set-edition/theme`
 * - 文字組み       生 px → `bodySmClass` / `captionClass` (typography トークン)
 */

type JournalItem = {
  _id: string;
  slug: { current: string };
  title: string;
  theme: string;
  summary?: string;
  mainImage?: { asset: object; alt?: string };
  thumbnail?: { asset: object; alt?: string };
};

export default async function SetEditionListPage() {
  const t = await getTranslations("elxeaJournal");
  const bt = await getTranslations("breadcrumb");

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: t("title") }]} />
      <ListPageHead overline="SET EDITION" title={t("title")} lead={t("description")} />
      <SetEditionGrid />
    </Section>
  );
}

async function SetEditionGrid() {
  const locale = await getLocale();
  const t = await getTranslations("elxeaJournal");

  let journals: JournalItem[];
  try {
    const client = getClient();
    const fetched = await client.fetch(JOURNALS_QUERY, { language: locale });
    // Preview-only: the dataset has no tea-menu journals, so inject dummy
    // entries to review the grid. No effect when flag unset / real data exists.
    journals = withSeedJournals(fetched) as JournalItem[];
  } catch {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>;
  }

  if (!journals || journals.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("empty")}</p>;
  }

  return (
    <CatalogGrid className="mt-8 lg:mt-12">
      {journals.map((journal) => {
        const image = journal.thumbnail ?? journal.mainImage;
        // Preview-only: fall back to a stable local placeholder photo when the
        // journal entry has no imagery. No effect when flag unset.
        const resolvedImage = image?.asset
          ? urlFor(image).width(600).height(400).url()
          : previewSeedEnabled()
            ? previewImageForKey(journal._id)
            : undefined;

        return (
          <Link
            key={journal._id}
            href={`/elxea-journal/${journal.slug.current}`}
            data-slot="set-edition-card"
            className="group flex flex-col gap-3 lg:gap-5"
          >
            <div className="relative">
              <ImageCard image={resolvedImage} alt={image?.alt || journal.title} hover />
              <ThemeBadge theme={journal.theme} className="absolute top-3 left-3 z-10" />
            </div>
            <div className="flex flex-col items-start gap-2 text-left">
              <h2
                data-slot="catalog-card-title"
                className={cn(bodySmClass, "text-foreground underline-offset-4 group-hover:underline")}
              >
                {journal.title}
              </h2>
              {journal.summary ? (
                <p className={cn(captionClass, "line-clamp-2 text-muted-foreground")}>
                  {journal.summary}
                </p>
              ) : null}
            </div>
          </Link>
        );
      })}
    </CatalogGrid>
  );
}
