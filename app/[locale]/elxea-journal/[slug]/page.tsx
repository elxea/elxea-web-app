import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import { JOURNAL_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Link } from "@/i18n/navigation";
import { Section } from "@/components/layout/container";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { PortableText } from "@/components/sanity/portable-text";
import { ImageCard } from "@/components/ui/image-card";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { TeaSpecCard } from "@/components/set-edition/tea-spec-card";
import { ThemeBadge } from "@/components/set-edition/theme";
import { CatalogGrid } from "@/components/catalog/catalog-list";
import { bodySmClass, captionClass, overlineClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * Set Edition 詳細 (`/elxea-journal/[slug]`) — C3 の DS 移行。
 *
 * 呼称は「Set Edition」(旧「ニュースレター」は廃語 / Setaka 2026-08-11 確定)。
 * URL は互換のため据え置き。
 *
 * DS 移行の中身 (新規部品は作らない):
 * - 外枠           `section-narrow` / `section-wide` の直書き → `Section`
 * - パンくず       無し → `Breadcrumb`
 * - テーマバッジ   ページ内の重複定数 → `components/set-edition/theme`
 * - ヒーロー写真   生の `aspect-[2/1]` + `bg-muted` → `ImageCard`
 * - お茶グリッド   手組み 3 列 → `CatalogGrid`
 * - 文字組み       生 px (`text-[11px]` / `tracking-[0.25em]`) →
 *                  `overlineClass` / `captionClass` / `bodySmClass`
 */

type TeaMenuItem = {
  _id: string;
  slug: { current: string };
  displayName: string;
  productNumber: string;
  category: string;
  variety: string;
  season: string;
  origin: string;
  netWeight: number;
  photo?: { asset: object; alt?: string };
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  try {
    const client = getClient();
    const journal = await client.fetch(JOURNAL_BY_SLUG_QUERY, { slug, language: locale });
    if (!journal) return {};
    const seo = journal.seo;
    const title = seo?.title || journal.title;
    const description = seo?.description || journal.summary?.slice(0, 160);
    const image = journal.mainImage?.asset
      ? urlFor(journal.mainImage).width(1200).url()
      : undefined;
    return {
      title,
      description,
      openGraph: { title, description, images: image ? [{ url: image }] : [] },
    };
  } catch {
    return {};
  }
}

export default async function SetEditionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("elxeaJournal");
  const bt = await getTranslations("breadcrumb");

  let journal;
  try {
    const client = getClient();
    journal = await client.fetch(JOURNAL_BY_SLUG_QUERY, { slug, language: locale });
  } catch {
    return (
      <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
        <div className="mx-auto w-full max-w-160">
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
        </div>
      </Section>
    );
  }

  if (!journal) notFound();

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <div className="mx-auto w-full max-w-160">
        <Breadcrumb
          items={[
            { label: bt("home"), href: "/" },
            { label: t("title"), href: "/elxea-journal" },
            { label: journal.title },
          ]}
        />

        {/* Head — テーマバッジ + タイトル + サマリ (Figma 6760:120) */}
        <header className="mt-6">
          <ThemeBadge theme={journal.theme} />
          <h1 className="page-title mt-4 text-foreground">{journal.title}</h1>
          {journal.summary ? (
            <p className={cn(captionClass, "mt-4 text-muted-foreground")}>{journal.summary}</p>
          ) : null}
        </header>

        {/* ヒーロー写真 — 本文カラムから両側 40px はみ出す (SP は全幅) */}
        {journal.mainImage?.asset && (
          <div className="mt-6 -mx-4 lg:-mx-10">
            <ImageCard
              className="[--bleed-ar:3/2] lg:[--bleed-ar:16/9] rounded-none lg:rounded-md"
              style={{ aspectRatio: "var(--bleed-ar)" }}
            >
              <ImageWithFallback
                src={urlFor(journal.mainImage).width(1600).height(900).url()}
                fallbackSrc="/placeholder-hero-day.jpg"
                alt={journal.mainImage.alt || journal.title}
                fill
                sizes="(max-width: 1024px) 100vw, 720px"
                className="h-full w-full object-cover"
                priority
              />
            </ImageCard>
          </div>
        )}

        {/* 本文 */}
        {journal.body && (
          <div className="prose-custom mt-6">
            <PortableText value={journal.body} />
          </div>
        )}
      </div>

      {/* お届けのお茶について — グリッドは本文カラムより広く取る */}
      {journal.teaMenus && journal.teaMenus.length > 0 && (
        <section className="mt-16 border-t border-border pt-16">
          <p className={cn(overlineClass, "text-muted-foreground")}>Tea Selection</p>
          <h2 className="mt-4 text-foreground">{t("teaSection")}</h2>
          <CatalogGrid className="mt-8 lg:mt-12">
            {journal.teaMenus.map((tea: TeaMenuItem) => (
              <TeaSpecCard key={tea._id} tea={tea} />
            ))}
          </CatalogGrid>
        </section>
      )}

      {/* プレイリスト */}
      {journal.playlist && (
        <section className="mt-16 border-t border-border pt-16">
          <div className="mx-auto w-full max-w-160">
            <p className={cn(overlineClass, "text-muted-foreground")}>Soundtrack</p>
            <h2 className="mt-4 text-foreground">{t("relatedPlaylist")}</h2>
            <Link
              href={`/playlists/${journal.playlist.slug.current}`}
              className="group mt-8 flex items-center gap-5"
            >
              {journal.playlist.albumImage?.asset && (
                <div className="size-20 shrink-0">
                  <ImageCard style={{ aspectRatio: "1/1" }}>
                    <Image
                      src={urlFor(journal.playlist.albumImage).width(160).height(160).url()}
                      alt={journal.playlist.title}
                      width={160}
                      height={160}
                      className="h-full w-full object-cover"
                    />
                  </ImageCard>
                </div>
              )}
              <div>
                <p
                  className={cn(
                    bodySmClass,
                    "text-foreground underline-offset-4 group-hover:underline"
                  )}
                >
                  {journal.playlist.title}
                </p>
                {journal.playlist.spotifyUrl && (
                  <p className={cn(captionClass, "mt-2 text-muted-foreground")}>Spotify</p>
                )}
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* 関連するコラム (Personal Edition 側の公開記事) */}
      {journal.relatedPost && (
        <section className="mt-16 border-t border-border pt-16">
          <div className="mx-auto w-full max-w-160">
            <p className={cn(overlineClass, "text-muted-foreground")}>Related Article</p>
            <h2 className="mt-4 text-foreground">{t("relatedPost")}</h2>
            <Link
              href={`/journal/${journal.relatedPost.slug.current}`}
              className={cn(
                bodySmClass,
                "mt-8 inline-flex h-12 items-center text-foreground underline underline-offset-4 hover:text-muted-foreground"
              )}
            >
              {journal.relatedPost.title}
            </Link>
          </div>
        </section>
      )}
    </Section>
  );
}
