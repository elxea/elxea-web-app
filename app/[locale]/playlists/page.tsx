import type { Metadata } from "next";
import { Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import { PLAYLISTS_QUERY } from "@/sanity/lib/queries";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import { CatalogToolbar } from "@/components/catalog/catalog-toolbar";
import { ListPageHead, MoreRow } from "@/components/catalog/catalog-list";
import { ImageCard } from "@/components/ui/image-card";
import { ArticleCard } from "@/components/journal/article-card";
import {
  ArticleRail,
  HeroFeature,
  JournalGrid,
  JournalLayout,
} from "@/components/journal/journal-list";
import { urlFor } from "@/sanity/lib/image";
import { formatArticleDate } from "@/lib/format-date";
import { previewSeedEnabled, previewImageForKey } from "@/lib/preview-seed";
import { toPlainText } from "@/lib/sanity-text";
import type { PortableTextBlock } from "@portabletext/types";

/**
 * プレイリスト一覧 — Figma【R2: 確定版】ジャーナル一覧整合 + 今月号特集枠 +
 * サイドバー (PC 8085:4299 / SP 8085:4353) の実装。
 *
 * 構成: Breadcrumb → PageHead → 今月号特集枠 → Toolbar (シーンのチップ +
 * 並び替え) → [プレイリストグリッド + サイドバー] → もっと見る。
 * Figma がカードに `ArticleCard — elxea/Journal S3` を、枠に journal 一覧と
 * 同じ 936 + 344 を指定しているため、部品はジャーナル一覧と丸ごと共有し
 * (`components/catalog/*` + `components/journal/journal-list.tsx`)、この
 * ファイルはプレイリストのデータをカードの形に写す役だけを持つ。
 *
 * 絞り込み (`?category=` = シーン) / 並び替え (`?sort=`) / 表示件数
 * (`?show=`) は URL に載せる。既定は新しい順 (ジャーナルのおすすめ順に相当する
 * 行動ログはプレイリストには無いため)。
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("playlist");
  return {
    title: t("title"),
    description: t("description"),
    openGraph: { title: t("title"), description: t("description") },
  };
}

/** Figma のグリッドは 2 列 x 3 段 = 6 件を初期表示する (8085:4327)。 */
const PAGE_SIZE = 6;

/** サイドバー「よく聴かれている」の件数 (Figma 8085:4337 は 5 行)。 */
const RAIL_SIZE = 5;

type SearchParams = { category?: string; sort?: string; show?: string };

type PlaylistItem = {
  _id: string;
  slug: { current: string };
  title: string;
  category?: string;
  albumImage?: { asset: object; alt?: string };
  description?: PortableTextBlock[] | string;
  featured?: boolean;
  dateRecorded?: string;
  artist?: { name: string };
};

/** 特集写真は 1312x546 で切り出す (Figma 8085:4309)。 */
function heroImage(pl: PlaylistItem): string | undefined {
  if (pl.albumImage?.asset) return urlFor(pl.albumImage).width(1312).height(546).url();
  return previewSeedEnabled() ? previewImageForKey(pl._id) : undefined;
}

/**
 * プレイリストを ArticleCard が読む形に写す。`category` は Sanity では
 * ただの文字列 (シーン名) なので、slug も同じ文字列にして
 * `?category=<シーン>` で往復させる。
 */
function toCardShape(pl: PlaylistItem) {
  return {
    _id: pl._id,
    slug: pl.slug,
    title: pl.title,
    excerpt: toPlainText(pl.description) || undefined,
    thumbnail: pl.albumImage,
    publishedAt: pl.dateRecorded,
    category: pl.category
      ? { title: pl.category, slug: { current: pl.category } }
      : undefined,
    author: pl.artist ? { name: pl.artist.name } : undefined,
  };
}

export default async function PlaylistsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const t = await getTranslations("playlist");
  const bt = await getTranslations("breadcrumb");

  return (
    <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
      <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: t("heading") }]} />

      <ListPageHead overline="PLAYLIST" title={t("heading")} lead={t("lead")} />

      <Suspense fallback={<PlaylistSkeleton />}>
        <PlaylistContent params={params} />
      </Suspense>
    </Section>
  );
}

function PlaylistSkeleton() {
  return (
    <JournalGrid className="mt-8 lg:mt-12">
      {Array.from({ length: PAGE_SIZE }).map((_, i) => (
        <div key={i} className="flex animate-pulse flex-col gap-4">
          <ImageCard />
          <div className="space-y-1.5">
            <div className="h-3 w-16 bg-muted" />
            <div className="h-4 w-3/4 bg-muted" />
            <div className="h-3 w-full bg-muted" />
          </div>
        </div>
      ))}
    </JournalGrid>
  );
}

async function PlaylistContent({ params }: { params: SearchParams }) {
  const locale = await getLocale();
  const t = await getTranslations("playlist");
  const tCommon = await getTranslations("common");
  const tl = await getTranslations("catalog");

  let raw: PlaylistItem[];
  try {
    raw = await getClient().fetch(PLAYLISTS_QUERY);
  } catch {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("loadError")}</p>;
  }

  const playlists = raw ?? [];
  if (playlists.length === 0) {
    return <p className="mt-8 text-sm text-muted-foreground lg:mt-12">{t("empty")}</p>;
  }

  // シーンのチップは実在するシーンだけ (件数 0 のチップは出さない)。
  const scenes = Array.from(
    new Set(playlists.map((pl) => pl.category).filter(Boolean) as string[])
  );
  const chips = [
    { value: "all", label: tl("all") },
    ...scenes.map((scene) => ({ value: scene, label: scene })),
  ];
  const activeScene =
    params.category && scenes.includes(params.category) ? params.category : "all";

  const sort = params.sort === "oldest" ? "oldest" : "newest";

  // 今月号の特集は「編集判断で指定」(Figma 8085:4307)。Sanity の featured を
  // 唯一の根拠にし、無ければ最新の 1 件を充てる。絞り込み中は出さない
  // (絞り込み結果と特集が食い違うため)。
  const featured =
    activeScene === "all" ? (playlists.find((pl) => pl.featured) ?? playlists[0]) : undefined;

  const pool = playlists.filter((pl) => pl._id !== featured?._id);
  const filtered =
    activeScene === "all" ? pool : pool.filter((pl) => pl.category === activeScene);

  // PLAYLISTS_QUERY は録音日の新しい順。古い順は反転で足りる。
  const ordered = sort === "oldest" ? [...filtered].reverse() : filtered;

  const show = Math.max(PAGE_SIZE, Number(params.show) || PAGE_SIZE);
  const visible = ordered.slice(0, show);
  const remaining = ordered.length - visible.length;

  const query = (extra: Record<string, string>) => {
    const usp = new URLSearchParams();
    if (activeScene !== "all") usp.set("category", activeScene);
    if (sort !== "newest") usp.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) usp.set(k, v);
    const qs = usp.toString();
    return qs ? `/playlists?${qs}` : "/playlists";
  };

  const railPopular = playlists
    .filter((pl) => pl.featured)
    .concat(playlists.filter((pl) => !pl.featured))
    .slice(0, RAIL_SIZE)
    .map((pl) => ({ label: pl.title, href: `/playlists/${pl.slug.current}` }));

  const railScenes = scenes.map((scene) => ({
    label: scene,
    href: `/playlists?category=${encodeURIComponent(scene)}`,
  }));

  return (
    <>
      {featured ? (
        <HeroFeature
          className="mt-8 lg:mt-12"
          href={`/playlists/${featured.slug.current}`}
          label={t("featured")}
          image={heroImage(featured)}
          imageAlt={featured.albumImage?.alt ?? featured.title}
          meta={[
            featured.category,
            formatArticleDate(featured.dateRecorded) || null,
          ]
            .filter(Boolean)
            .join(" — ")}
          title={featured.title}
          lead={toPlainText(featured.description) || undefined}
        />
      ) : null}

      <CatalogToolbar
        className="mt-8 lg:mt-12"
        chips={chips}
        activeChip={activeScene}
        activeSort={sort}
        sortLabel={tl("sortLabel")}
        sortOptions={[
          { value: "newest", label: tl("sortNewest") },
          { value: "oldest", label: tl("sortOldest") },
        ]}
      />

      <JournalLayout className="mt-8 lg:mt-12">
        {visible.length === 0 ? (
          <p className="order-1 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <JournalGrid>
            {visible.map((pl) => (
              <ArticleCard
                key={pl._id}
                article={toCardShape(pl)}
                memberOnlyLabel={tCommon("memberOnly")}
                hrefBase="/playlists"
              />
            ))}
          </JournalGrid>
        )}

        {remaining > 0 ? (
          <MoreRow
            className="order-2 mt-8 lg:col-span-2 lg:mt-12"
            href={query({ show: String(show + PAGE_SIZE) })}
            label={tl("showMore", { count: Math.min(remaining, PAGE_SIZE) })}
          />
        ) : null}

        <ArticleRail
          popularTitle={t("popular")}
          popular={railPopular}
          categoryTitle={t("scenes")}
          categories={railScenes}
        />
      </JournalLayout>
    </>
  );
}
