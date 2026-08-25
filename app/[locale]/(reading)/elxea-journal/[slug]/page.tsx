import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { PortableTextBlock } from "@portabletext/types";

import { getClient } from "@/sanity/lib/client";
import { JOURNAL_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Section } from "@/components/layout/container";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { PortableText } from "@/components/sanity/portable-text";
import { captionClass } from "@/components/editorial/rule-list";
import { AuthorByline } from "@/components/journal/author-byline";
import { ReadingProgress } from "@/components/journal/reading-progress";
import {
  ArticleBlock,
  ArticleColumn,
  ArticleHead,
  ArticleImageBleed,
  ArticleLead,
  ArticleNextRead,
  ArticlePill,
  ArticleProductRow,
  ArticleProse,
  ArticleReadList,
  ArticleReadRow,
  articlePagePadding,
} from "@/components/journal/article-blocks";
import { Link } from "@/i18n/navigation";
import { filterOutFictional } from "@/lib/fictional-content";
import {
  previewImageForKey,
  previewSeedEnabled,
  seedJournalDetail,
  withSeedJournalDetail,
} from "@/lib/preview-seed";
import { cn } from "@/lib/utils";

/**
 * elxea Journal 記事詳細 — Figma【R2: 確定版】本文完結 + 末尾のみ回遊
 * (同梱セット文脈・執筆者クレジット) PC 8110:46893 / SP 8110:47043 の実装。
 *
 * 確定版の節構成をそのまま順に組む:
 *   1. ReadingProgress   2px の追従バー (ヘッダー直下)
 *   2. Breadcrumb        PC のみ Figma に掲載 (共通部品のまま)
 *   3. Head              ELXEA JOURNAL キッカー + 記事タイトル + 執筆者クレジット
 *   4. lead              明朝のリード文
 *   5. 冒頭写真          本文から左右 40 はみ出す (SP は全幅) + 写真内キャプション
 *   6. 本文              段落 24 / 節見出し前 80・後 44 の縦リズム
 *   7. この号に入っているお茶  同梱セットの文脈 (thumb + 名称 + 産地 + 詳細リンク)
 *   8. この号のほかの読みもの  末尾のみの回遊 (行 72 / thumb 56) = 行き止まり回避
 *   9. NextRead          テーマ回遊の pill (末尾のみ)
 *
 * データが無い節は枠ごと出さない (空枠を出さない方針 — C4-2 PDP / C4-3 / C4-4a と同じ)。
 * 7〜9 は C4-4b で Sanity schema に追加した `author` / `mainImage.caption` /
 * `otherReads` / `nextReadTags` と既存の `teaMenus` を唯一の根拠にする。
 *
 * 確定版に枠が無いが実装に残すもの (意図的差分):
 * - Playlist …… Figma 非掲載だが既存データ (`playlist`) を落とさないため、
 *   同梱文脈の節として「この号に入っているお茶」の直後に置く。
 * 確定版で落としたもの (意図的差分):
 * - Theme badge (6934:143) …… 確定版の Head は色バッジではなく英字キッカーに
 *   置き換わった。バッジは一覧 (`app/[locale]/elxea-journal/page.tsx`) に残る。
 * - TeaSpecCard の 3 カラムグリッド …… 確定版では 1 行の product row になった。
 */

type PhotoRef = { asset: object; alt?: string; caption?: string };

type ReadRef = {
  _id: string;
  title: string;
  slug: { current: string };
  thumbnail?: PhotoRef;
  mainImage?: PhotoRef;
};

type TagRef = { _id: string; title: string; slug: { current: string } };

type TeaMenuRef = {
  _id: string;
  slug: { current: string };
  title?: string;
  displayName?: string;
  origin?: string;
  variety?: string;
  photo?: PhotoRef;
};

type Journal = {
  _id: string;
  title: string;
  slug: { current: string };
  theme?: string;
  summary?: string;
  body?: PortableTextBlock[];
  mainImage?: PhotoRef;
  /** プレビュー見本のみが使う平坦なキャプション (実データは mainImage.caption)。 */
  mainImageCaption?: string;
  author?: {
    name: string;
    role?: string;
    image?: { asset: object };
    slug?: { current: string };
  };
  teaMenus?: TeaMenuRef[];
  relatedPost?: ReadRef;
  otherReads?: ReadRef[];
  nextReadTags?: TagRef[];
  playlist?: {
    title: string;
    slug: { current: string };
    albumImage?: { asset: object };
    spotifyUrl?: string;
  };
  seo?: { title?: string; description?: string };
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
    const journal: Journal | null = await client.fetch(JOURNAL_BY_SLUG_QUERY, {
      slug,
      language: locale,
    });
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

/** 写真の URL。プレビュー時だけプレースホルダを補う (production は無影響)。 */
function photoUrl(
  photo: PhotoRef | undefined,
  seedKey: string,
  width: number,
  height: number
): string | undefined {
  if (photo?.asset) return urlFor(photo).width(width).height(height).url();
  return previewSeedEnabled() ? previewImageForKey(seedKey) : undefined;
}

export default async function ElxeaJournalDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("elxeaJournal");
  const bt = await getTranslations("breadcrumb");

  let journal: Journal | null;
  try {
    const client = getClient();
    journal = await client.fetch(JOURNAL_BY_SLUG_QUERY, { slug, language: locale });
  } catch {
    return (
      <Section spacing="none" className={articlePagePadding}>
        <ArticleColumn>
          <p className={cn(captionClass, "text-muted-foreground")}>
            {t("loadError")}
          </p>
        </ArticleColumn>
      </Section>
    );
  }

  // Preview-only: 一覧の見本カード (`seed-journal-N`) から開いたときだけ見本の
  // 詳細を返す。フラグ未設定時は常に null なので production は 404 のまま。
  journal = journal ?? (seedJournalDetail(slug) as Journal | null);

  if (!journal) notFound();

  // The journal issue itself is real content, but its referenced tea menus can
  // still point at the fictional/seed docs left in the production dataset. Drop
  // those references at the read layer (no Sanity mutation) so a real issue
  // never links to invented tea.
  //
  // プレイリストは 8/22 に同じ理由で落としていたが、Setaka が 2026-08-26 に
  // 判断を上書きした (「以前あげた音源を自前プレイヤーで聴けるように戻す」)。
  // よってここでも素通しする。詳細は lib/fictional-content.ts。
  const journalTeaMenus: typeof journal.teaMenus = filterOutFictional(
    "teaMenu",
    journal.teaMenus,
  );
  const journalPlaylist = journal.playlist ?? null;

  // Preview-only: production dataset の journal は確定版のフィールドを持たない
  // ため、フラグが立っているときだけ未入力欄を見本で埋めて実寸を確認できる
  // ようにする。フラグ未設定時は byte-identical (何も足さない)。
  journal = withSeedJournalDetail(journal) as Journal;

  /* --- 5. 冒頭写真 -------------------------------------------------------- */

  const heroImage = photoUrl(journal.mainImage, journal._id, 1440, 864);
  const heroCaption = journal.mainImage?.caption ?? journal.mainImageCaption;

  /* --- 7. この号に入っているお茶 ------------------------------------------ */

  const teaRows = (journalTeaMenus ?? []).map((tea, i) => ({
    key: tea._id,
    href: `/tea-menu/${tea.slug.current}`,
    image: photoUrl(tea.photo, `${tea._id}-${i}`, 320, 320),
    imageAlt: tea.photo?.alt ?? tea.displayName ?? tea.title ?? "",
    title: tea.displayName || tea.title || "",
    // Figma のメタは「産地 / 同梱文脈」の 2 部構成。同梱文脈は節ラベル
    // (この号に入っているお茶) が担うので、品目側は実データの産地と品種だけを出す。
    meta: [tea.origin, tea.variety].filter(Boolean).join(" / ") || undefined,
  }));

  /* --- 8. この号のほかの読みもの ------------------------------------------ */

  // 確定版は 3 本。`otherReads` 未設定なら既存の `relatedPost` を 1 行として使う。
  const readSource: ReadRef[] =
    journal.otherReads && journal.otherReads.length > 0
      ? journal.otherReads
      : journal.relatedPost
        ? [journal.relatedPost]
        : [];

  const readRows = readSource.slice(0, 3).map((read) => {
    const image = read.thumbnail ?? read.mainImage;
    return {
      key: read._id,
      href: `/journal/${read.slug.current}`,
      image: photoUrl(image, read._id, 112, 112),
      imageAlt: image?.alt ?? read.title,
      title: read.title,
    };
  });

  /* --- 9. テーマ回遊 ------------------------------------------------------ */

  const nextReadTags = (journal.nextReadTags ?? []).slice(0, 2);

  return (
    <>
      <ReadingProgress />

      <Section spacing="none" className={articlePagePadding}>
        <ArticleColumn>
          {/* Breadcrumb は共通部品が下余白 32 を内包するので、確定版の縦リズム
              24 に合わせるため打ち消して Head 側の mt-6 で作る。 */}
          <div className="[&_nav]:mb-0">
            <Breadcrumb
              items={[
                { label: bt("home"), href: "/" },
                { label: t("title"), href: "/elxea-journal" },
                { label: journal.title },
              ]}
              locale={locale}
            />
          </div>

          <ArticleHead
            overline={t("kicker")}
            title={journal.title}
            className="mt-6"
          >
            {journal.author ? (
              journal.author.slug?.current ? (
                /* C17-1: 著者ページは People 詳細へ統合済み (旧 URL は
                   next.config.ts の 308 で寄せてある)。 */
                <Link href={`/people/${journal.author.slug.current}`}>
                  <AuthorByline
                    name={journal.author.name}
                    role={journal.author.role}
                    avatarUrl={
                      journal.author.image?.asset
                        ? urlFor(journal.author.image).width(64).height(64).url()
                        : undefined
                    }
                  />
                </Link>
              ) : (
                <AuthorByline
                  name={journal.author.name}
                  role={journal.author.role}
                  avatarUrl={
                    journal.author.image?.asset
                      ? urlFor(journal.author.image).width(64).height(64).url()
                      : undefined
                  }
                />
              )
            ) : null}
          </ArticleHead>

          {journal.summary ? (
            <ArticleLead className="mt-6">{journal.summary}</ArticleLead>
          ) : null}

          {heroImage ? (
            <ArticleImageBleed
              className="mt-6"
              src={heroImage}
              alt={journal.mainImage?.alt || journal.title}
              caption={heroCaption}
              priority
            />
          ) : null}

          {journal.body ? (
            <ArticleProse className="mt-6">
              <PortableText value={journal.body} />
            </ArticleProse>
          ) : null}

          {teaRows.length > 0 ? (
            <ArticleBlock className="mt-6" label={t("issueTeas")}>
              <ul className="space-y-6">
                {teaRows.map((tea) => (
                  <ArticleProductRow
                    key={tea.key}
                    image={tea.image}
                    imageAlt={tea.imageAlt}
                    title={tea.title}
                    meta={tea.meta}
                    href={tea.href}
                    linkLabel={t("teaDetailOpen")}
                  />
                ))}
              </ul>
            </ArticleBlock>
          ) : null}

          {/* 確定版に枠は無いが、既存のプレイリストデータを落とさないため
              同梱文脈の節として残す (意図的差分)。 */}
          {journalPlaylist ? (
            <ArticleBlock className="mt-6" label={t("relatedPlaylist")}>
              <ul className="space-y-6">
                <ArticleProductRow
                  image={
                    journalPlaylist.albumImage?.asset
                      ? urlFor(journalPlaylist.albumImage)
                          .width(320)
                          .height(320)
                          .url()
                      : undefined
                  }
                  imageAlt={journalPlaylist.title}
                  title={journalPlaylist.title}
                  // 配信サービス名は出さない。elxea は音源を自前プレイヤーで
                  // 聴かせる方針で、Spotify 等へは上げない (Setaka 2026-08-11 /
                  // 再確認 2026-08-26)。seed の `spotifyUrl` は実在しない
                  // example URL なので、あることを根拠に「Spotify」と書くと
                  // 存在しない配信先を読者に断言することになる。
                  href={`/playlists/${journalPlaylist.slug.current}`}
                  linkLabel={t("teaDetailLink")}
                />
              </ul>
            </ArticleBlock>
          ) : null}

          {readRows.length > 0 ? (
            <ArticleBlock className="mt-6" label={t("otherReads")} gap="sm">
              <ArticleReadList>
                {readRows.map((read) => (
                  <ArticleReadRow
                    key={read.key}
                    href={read.href}
                    image={read.image}
                    imageAlt={read.imageAlt}
                    title={read.title}
                  />
                ))}
              </ArticleReadList>
            </ArticleBlock>
          ) : null}

          {nextReadTags.length > 0 ? (
            <ArticleNextRead className="mt-6">
              {nextReadTags.map((tag) => (
                <ArticlePill
                  key={tag._id}
                  href={`/journal/tag/${tag.slug.current}`}
                >
                  {t("nextReadTag", { name: tag.title })}
                </ArticlePill>
              ))}
            </ArticleNextRead>
          ) : null}
        </ArticleColumn>
      </Section>
    </>
  );
}
