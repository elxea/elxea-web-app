import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import {
  OTHER_PLAYLISTS_QUERY,
  PLAYLIST_BY_SLUG_QUERY,
} from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { AuthorByline } from "@/components/journal/author-byline";
import { SpecBand } from "@/components/editorial/section-blocks";
import { PortableText } from "@/components/sanity/portable-text";
import {
  CuratorQuote,
  PhotoCardGrid,
  PlaylistHead,
  PlaylistSection,
  PlaylistSectionBody,
  PlaylistSectionHead,
  PlaylistSectionNote,
  TrackList,
  type PhotoCardItem,
} from "@/components/playlist/playlist-detail";
import { getProductByHandle } from "@/lib/shopify";
import { formatPrice } from "@/lib/utils";
import { formatArticleDate } from "@/lib/format-date";
import { previewSeedEnabled, previewImageForKey } from "@/lib/preview-seed";
import { toPlainText } from "@/lib/sanity-text";
import type { PortableTextBlock } from "@portabletext/types";

/**
 * プレイリスト詳細 — Figma【R2: 確定版】People 詳細テンプレ整合 +
 * 収録アーティストプロフィール (PC 8089:4518 / SP 8089:4622) の実装。
 *
 * 確定版の 7 ブロック構成 (D2-3 記録) をそのまま節にする:
 *   1. PlaylistHead   アートワーク + 見出し + 実数 (曲数 / 分数) + 選盤者
 *   2. Quote          反転面・選盤者の一言
 *   3. ARTISTS        収録アーティストのプロフィール (写真必須)
 *   4. TRACKS         収録曲 (本文幅 640 / サイドバー無し)
 *   5. PLAYLIST DATA  4 カラムのデータ帯
 *   6. 合わせるお茶    購入導線は最下部
 *   7. OTHER PLAYLISTS ほかの月のプレイリスト
 *
 * データが無い節は枠ごと出さない (空枠を出さない方針 — C4-2 の PDP 読みものと
 * 同じ)。3〜6 は C4-3 で Sanity schema に追加したフィールド
 * (`artists` / `tracks` / `dataBand` / `pairedTeas`) を唯一の根拠にする。
 *
 * 上の 7 ブロック以外の節は置かない。C4-3 まで残っていた旧実装の
 * 「LISTEN / 配信で聴く」節 (Spotify・SoundCloud・YouTube リンク + 録音日) は
 * 確定版の構成に無いため C4-2R で削除した (C4-3 QA F1)。`spotifyUrl` /
 * `soundcloudUrl` / `youtubeUrl` / `dateRecorded` は Sanity schema と
 * `PLAYLIST_BY_SLUG_QUERY` には残してある (入力済みデータを消さないため) が、
 * このページでは描画しない。配信リンクの枠が必要になったら Figma 側に足して
 * 凍結してから実装する — コード側で先に生やさない。
 */

type AuthorRef = {
  _id?: string;
  name: string;
  slug?: { current: string };
  image?: { asset: object; alt?: string };
  role?: string;
  bio?: string;
};

type Track = { title: string; note?: string; minutes?: number };

type Playlist = {
  _id: string;
  slug: { current: string };
  title: string;
  category?: string;
  artist?: AuthorRef;
  artists?: AuthorRef[];
  albumImage?: { asset: object; alt?: string };
  description?: PortableTextBlock[] | string;
  body?: PortableTextBlock[];
  curatorQuote?: string;
  curatorQuoteBy?: string;
  tracks?: Track[];
  dataBand?: { label: string; value: string }[];
  pairedTeas?: string[];
  spotifyUrl?: string;
  soundcloudUrl?: string;
  youtubeUrl?: string;
  dateRecorded?: string;
  colors?: { color1?: string; color2?: string; primary?: string; secondary?: string };
};

type OtherPlaylist = {
  _id: string;
  slug: { current: string };
  title: string;
  category?: string;
  albumImage?: { asset: object; alt?: string };
  dateRecorded?: string;
  artist?: { name: string };
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const pl: Playlist | null = await getClient().fetch(PLAYLIST_BY_SLUG_QUERY, { slug });
    if (!pl) return {};
    const image = pl.albumImage?.asset ? urlFor(pl.albumImage).width(800).url() : undefined;
    const descText = toPlainText(pl.description).slice(0, 160);
    return {
      title: pl.title,
      description: descText || undefined,
      openGraph: {
        title: pl.title,
        description: descText || undefined,
        images: image ? [{ url: image }] : [],
      },
    };
  } catch {
    return {};
  }
}

export default async function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("playlist");
  const bt = await getTranslations("breadcrumb");

  let pl: Playlist | null;
  let others: OtherPlaylist[] = [];
  try {
    const client = getClient();
    pl = await client.fetch(PLAYLIST_BY_SLUG_QUERY, { slug });
    if (pl) others = (await client.fetch(OTHER_PLAYLISTS_QUERY, { slug })) ?? [];
  } catch {
    return (
      <div className="page-container py-16">
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!pl) notFound();

  /* --- 1. PlaylistHead ---------------------------------------------------- */

  const heroImage = pl.albumImage?.asset
    ? urlFor(pl.albumImage).width(640).height(800).url()
    : previewSeedEnabled()
      ? previewImageForKey(pl._id)
      : undefined;

  const tracks = pl.tracks ?? [];
  const totalMinutes = tracks.reduce((sum, track) => sum + (track.minutes ?? 0), 0);

  // 実数表示は「数えられるものだけ」出す。曲が未登録なら Stats ごと出さない。
  const stats = [
    tracks.length > 0 ? { value: tracks.length, label: t("tracks") } : null,
    totalMinutes > 0 ? { value: totalMinutes, label: t("minutes") } : null,
  ].filter(Boolean) as { value: number; label: string }[];

  /* --- 6. 合わせるお茶 (Shopify) ------------------------------------------ */

  const pairedHandles = pl.pairedTeas ?? [];
  const pairedProducts = (
    await Promise.all(
      pairedHandles.slice(0, 3).map(async (handle) => {
        try {
          return await getProductByHandle(handle);
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);

  const teaItems: PhotoCardItem[] = pairedProducts.map((product) => {
    const p = product!;
    const price = p.priceRange?.minVariantPrice;
    return {
      key: p.handle,
      href: `/products/${p.handle}`,
      image: p.featuredImage?.url ?? undefined,
      imageAlt: p.featuredImage?.altText ?? p.title,
      title: p.title,
      note: p.vendor || undefined,
      meta: price ? formatPrice(price.amount, price.currencyCode) : undefined,
    };
  });

  /* --- 3. ARTISTS --------------------------------------------------------- */

  const artistItems: PhotoCardItem[] = (pl.artists ?? []).map((artist, i) => ({
    key: artist._id ?? `${artist.name}-${i}`,
    href: artist.slug?.current ? `/people/${artist.slug.current}` : undefined,
    image: artist.image?.asset
      ? urlFor(artist.image).width(416).height(312).url()
      : previewSeedEnabled()
        ? previewImageForKey(artist._id ?? artist.name)
        : undefined,
    imageAlt: artist.image?.alt ?? artist.name,
    overline: `NO ${String(i + 1).padStart(2, "0")}`,
    title: artist.name,
    note: artist.role,
    meta: artist.bio,
  }));

  /* --- 7. OTHER PLAYLISTS ------------------------------------------------- */

  const otherItems: PhotoCardItem[] = others.map((other) => ({
    key: other._id,
    href: `/playlists/${other.slug.current}`,
    image: other.albumImage?.asset
      ? urlFor(other.albumImage).width(416).height(260).url()
      : previewSeedEnabled()
        ? previewImageForKey(other._id)
        : undefined,
    imageAlt: other.albumImage?.alt ?? other.title,
    title: other.title,
    note: [
      other.category,
      formatArticleDate(other.dateRecorded) || null,
    ]
      .filter(Boolean)
      .join(" — "),
  }));

  return (
    <>
      <PlaylistHead
        overline="PLAYLIST"
        title={pl.title}
        subtitle={pl.category}
        lead={toPlainText(pl.description) || undefined}
        image={heroImage}
        imageAlt={pl.albumImage?.alt ?? pl.title}
        stats={stats}
        bylineLabel={pl.artist ? t("curatedBy") : undefined}
        byline={
          pl.artist ? (
            <AuthorByline
              name={pl.artist.name}
              role={pl.artist.role}
              avatarUrl={
                pl.artist.image?.asset
                  ? urlFor(pl.artist.image).width(64).height(64).url()
                  : undefined
              }
            />
          ) : undefined
        }
      >
        <Breadcrumb
          items={[
            { label: bt("home"), href: "/" },
            { label: t("heading"), href: "/playlists" },
            { label: pl.title },
          ]}
        />
      </PlaylistHead>

      {pl.curatorQuote ? (
        <CuratorQuote quote={pl.curatorQuote} attribution={pl.curatorQuoteBy} />
      ) : null}

      {artistItems.length > 0 ? (
        <PlaylistSection>
          <PlaylistSectionHead overline="ARTISTS" title={t("artistsHead")} />
          <PlaylistSectionBody>
            {/* Figma の ARTISTS の写真は PC 416x312 (4:3) / SP 3:2。 */}
            <PhotoCardGrid items={artistItems} aspect="4/3" aspectSp="3/2" />
          </PlaylistSectionBody>
          <PlaylistSectionNote>{t("artistsNote")}</PlaylistSectionNote>
        </PlaylistSection>
      ) : null}

      {tracks.length > 0 ? (
        <PlaylistSection>
          <PlaylistSectionHead overline="TRACKS" title={t("tracksHead")} />
          <PlaylistSectionBody>
            <TrackList
              items={tracks.map((track, i) => ({
                no: `TRACK ${String(i + 1).padStart(2, "0")}`,
                title: track.minutes
                  ? `${track.title} / ${track.minutes} ${t("minutesShort")}`
                  : track.title,
                note: track.note,
              }))}
            />
          </PlaylistSectionBody>
        </PlaylistSection>
      ) : null}

      {pl.dataBand && pl.dataBand.length > 0 ? (
        <PlaylistSection>
          <PlaylistSectionHead overline="PLAYLIST DATA" />
          <PlaylistSectionBody>
            <SpecBand
              items={pl.dataBand.map((row) => ({ term: row.label, value: row.value }))}
            />
          </PlaylistSectionBody>
        </PlaylistSection>
      ) : null}

      {teaItems.length > 0 ? (
        <PlaylistSection>
          <PlaylistSectionHead overline="TEAS FOR THIS PLAYLIST" title={t("teasHead")} />
          <PlaylistSectionBody>
            <PhotoCardGrid items={teaItems} />
          </PlaylistSectionBody>
          <PlaylistSectionNote>{t("teasNote")}</PlaylistSectionNote>
        </PlaylistSection>
      ) : null}

      {/* 本文は確定版に枠が無いので、入っているときだけ TRACKS の下に読み物として
          置く (既存データを落とさないため)。 */}
      {pl.body ? (
        <PlaylistSection>
          <div className="prose-custom max-w-160">
            <PortableText value={pl.body} />
          </div>
        </PlaylistSection>
      ) : null}

      {otherItems.length > 0 ? (
        <PlaylistSection>
          <PlaylistSectionHead overline="OTHER PLAYLISTS" title={t("otherHead")} />
          <PlaylistSectionBody>
            <PhotoCardGrid items={otherItems} />
          </PlaylistSectionBody>
        </PlaylistSection>
      ) : null}
    </>
  );
}
