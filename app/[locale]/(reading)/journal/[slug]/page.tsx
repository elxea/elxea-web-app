import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import { ARTICLE_BY_SLUG_QUERY, RELATED_ARTICLES_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { getProductByHandle } from "@/lib/shopify";
import type { MembershipTier } from "@/lib/shopify/customer";
import { getMembershipTier } from "@/lib/shopify/auth";
import { Link } from "@/i18n/navigation";
import { Section } from "@/components/layout/container";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { PortableText } from "@/components/sanity/portable-text";
import { ImageCard } from "@/components/media/image-card";
import { MemberGate } from "@/components/account/member-gate";
import { pillClass } from "@/components/ui/pill-button";
import {
  bodySmClass,
  captionClass,
  overlineClass,
} from "@/components/editorial/rule-list";
import { AudioBlock } from "@/components/journal/audio-block";
import { AuthorByline } from "@/components/journal/author-byline";
import { AuthorProfile } from "@/components/journal/author-profile";
import {
  RelatedReadingsSection,
  TeaDetailSection,
} from "@/components/journal/article-modal-sections";
import { ArticleProse } from "@/components/journal/article-blocks";
import { BookmarkButton } from "@/components/journal/bookmark-button";
import { ArticleReadTracker } from "@/components/journal/article-read-tracker";
import { ReadingProgress } from "@/components/journal/reading-progress";
import { formatArticleDate } from "@/lib/format-date";
import { readingMinutes } from "@/lib/journal/read-time";
import { cn } from "@/lib/utils";

/**
 * ジャーナル記事詳細 — Figma【R2: 確定版】実分量 + 記事末尾の関連リンク
 * (PC 8074:44849 / SP 8074:44999) の実装。
 *
 * Figma 実測 (px) → 実装:
 * - ReadingProgress   高さ 2 の追従バー (fill = 現在地) → `h-0.5` + sticky
 * - 本文カラム        PC 640 中央 (x400 / 1440)          → `mx-auto max-w-160`
 * - 縦リズム          24 一定                            → `mt-6`
 * - Head              JOURNAL → +16 見出し → +16 著者クレジット
 * - lead              明朝 (秀英横太明朝 = typography.family.special)
 * - 写真の裁ち落とし  PC 720 (= 640 + 40 x2) / SP 全幅    → `-mx-4 lg:-mx-10`
 *                     アスペクト SP 3/2 (375x250) / PC 5/3 (720x432)
 * - H2/H3            前 56 / 後 20                      → `mt-14` + 直後要素 `mt-5`
 * - 商品カード        thumb PC 160 / SP 96 + gap 24/16
 * - 関連記事          行 h72 / thumb 56 / gap 16
 * - NextRead          pill h48 中央
 */

type ArticleAuthor = {
  name: string;
  slug?: { current: string };
  image?: { asset: object };
  role?: string;
  bio?: string;
  website?: string;
};

type RelatedArticle = {
  _id: string;
  title: string;
  slug: { current: string };
  thumbnail?: { asset: object };
  mainImage?: { asset: object };
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
    const article = await client.fetch(ARTICLE_BY_SLUG_QUERY, { slug, language: locale });
    if (!article) return {};
    const seo = article.seo;
    const title = seo?.title || article.title;
    const description = seo?.description || article.excerpt?.slice(0, 160);
    const image = article.mainImage?.asset ? urlFor(article.mainImage).width(1200).url() : undefined;
    return {
      title,
      description,
      openGraph: { title, description, images: image ? [{ url: image }] : [] },
    };
  } catch {
    return {};
  }
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("journal");
  const tCommon = await getTranslations("common");
  const bt = await getTranslations("breadcrumb");

  let article;
  try {
    const client = getClient();
    article = await client.fetch(ARTICLE_BY_SLUG_QUERY, { slug, language: locale });
  } catch {
    return (
      <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
        <div className="mx-auto w-full max-w-160">
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
        </div>
      </Section>
    );
  }

  if (!article) notFound();

  // 会員ティアによる本文ゲート
  const requiredTier: MembershipTier =
    article.requiredTier ?? (article.memberOnly ? "standard" : "none");
  const isGated = requiredTier !== "none";
  const userTier = isGated ? await getMembershipTier() : ("none" as MembershipTier);
  const tierRank: Record<MembershipTier, number> = { none: 0, standard: 1, premium: 2 };
  const hasAccess = !isGated || tierRank[userTier] >= tierRank[requiredTier];

  // 記事末尾の関連記事 (Figma は 3 行)。
  //
  // A8: 以前は「カテゴリが設定されている記事」だけが関連記事を引いていたため、
  // カテゴリ未設定の記事はタグが付いていても関連記事の fetch すらせず、
  // 記事末尾が完全な行き止まりになっていた (クエリ自体はタグ一致も見ている)。
  // カテゴリかタグのどちらかがあれば引く。
  const tagIds: string[] = article.tags?.map((tag: { _id: string }) => tag._id) ?? [];
  let relatedArticles: RelatedArticle[] = [];
  if (hasAccess && (article.category?._id || tagIds.length > 0)) {
    try {
      const client = getClient();
      relatedArticles = await client.fetch(RELATED_ARTICLES_QUERY, {
        language: locale,
        currentId: article._id,
        // カテゴリ未設定のときに null を渡すと `category._ref == null` が
        // 「カテゴリ未設定の記事すべて」に当たってしまう。決して一致しない
        // 番兵を渡してタグ一致だけを効かせる。
        categoryId: article.category?._id ?? "__no-category__",
        tagIds,
      });
    } catch {
      // 関連記事は本文の必須要素ではないので黙って落とす
    }
  }

  // 「この記事に合わせたい茶葉」— Sanity の relatedProducts (Shopify ハンドル) を
  // 引き当てる。商品連動のある記事だけに出る枠 (Figma 8074:44880)。
  const handles: string[] = Array.isArray(article.relatedProducts)
    ? article.relatedProducts.filter((h: unknown): h is string => typeof h === "string")
    : [];
  const relatedProducts = hasAccess
    ? (
        await Promise.all(
          handles.slice(0, 3).map(async (handle) => {
            try {
              return await getProductByHandle(handle);
            } catch {
              return null;
            }
          })
        )
      ).filter((p): p is NonNullable<typeof p> => Boolean(p))
    : [];

  // AudioBlock / AudioPlayer / TrackRow / AudioDock が使う文言。client 側では
  // `getTranslations` を呼べないので、ここでまとめて解決して渡す。
  const audioLabels = {
    play: t("audioPlay"),
    pause: t("audioPause"),
    loading: t("audioLoading"),
    seek: t("audioSeek"),
    error: t("audioError"),
    close: t("audioClose"),
    nowPlaying: t("audioNowPlaying"),
    trackListLabel: t("audioTrackList"),
    externalNote: t("audioExternalNote"),
    interviewNote: t("audioInterviewNote"),
  };

  const author = article.author as ArticleAuthor | undefined;
  const authorAvatar = author?.image?.asset
    ? urlFor(author.image).width(64).height(64).url()
    : undefined;

  // 読了目安。本文が無い記事 (準備中・会員限定で本文を返していない等) では
  // null が返るので、その場合は表示ごと出さない。
  const readMinutes = readingMinutes(article.body);

  return (
    <>
      <ReadingProgress />

      <Section spacing="none" className="pt-6 pb-16 lg:pb-28">
        <article className="mx-auto w-full max-w-160">
          {/* 行動計測 — マウントで page_view、30 秒 or 80% スクロールで article_read */}
          <ArticleReadTracker articleSlug={slug} category={article.category?.slug?.current} />

          <Breadcrumb
            items={[
              { label: bt("home"), href: "/" },
              { label: t("title"), href: "/journal" },
              { label: article.category?.title ?? article.title },
            ]}
          />

          {/* Head — キッカー / 見出し / 著者クレジット */}
          <header className="mt-6">
            <p className={cn(overlineClass, "text-muted-foreground")}>JOURNAL</p>
            <div className="mt-4 flex items-start justify-between gap-4">
              {/* ページ主見出しは一覧・詳細で統一 (Setaka 裁定 2026-08-08):
                  44px display トークン = `.page-title`。Figma 記事詳細の
                  functional 52px 束縛は Figma 側を追従修正中のため、
                  実装は DS 最大の display (44px / lh 1.2) を正とする。
                  SP は base h1 32px のまま (.page-title は md+ のみ)。 */}
              <h1 className="page-title text-foreground">{article.title}</h1>
              <BookmarkButton
                articleSlug={slug}
                articleTitle={article.title}
                articleImageUrl={
                  article.mainImage?.asset ? urlFor(article.mainImage).width(200).url() : null
                }
                addLabel={t("addToBookmarks")}
                removeLabel={t("removeFromBookmarks")}
                savedLabel={t("bookmarkSaved")}
                loadingLabel={t("bookmarkLoading")}
                loginRequiredLabel={t("bookmarkLoginToSave")}
                statusUnknownLabel={t("bookmarkStatusUnknown")}
                addedMessage={t("addedToBookmarks")}
                removedMessage={t("removedFromBookmarks")}
                errorMessage={t("bookmarkError")}
                loginRequiredMessage={t("loginRequiredForBookmark")}
                statusRetryMessage={t("bookmarkStatusRetry")}
                className="mt-1 shrink-0"
              />
            </div>
            {author || readMinutes ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                {/* 著者が未設定でも日付・読了目安は出す (メタ行ごと消さない)。 */}
                {author &&
                  (author.slug?.current ? (
                    /* C17-1: 著者ページは People 詳細へ統合 (Figma 7805:1952
                       「【廃止: People 詳細へ統合】 ジャーナル:著者」)。旧 URL は
                       next.config.ts の 308 で寄せてあるが、内部リンクは 1 ホップ
                       無駄に踏ませないよう直接 /people/[slug] を指す。 */
                    <Link href={`/people/${author.slug.current}`}>
                      <AuthorByline
                        name={author.name}
                        role={author.role}
                        avatarUrl={authorAvatar}
                      />
                    </Link>
                  ) : (
                    <AuthorByline name={author.name} role={author.role} avatarUrl={authorAvatar} />
                  ))}
                {article.publishedAt && (
                  <time
                    dateTime={article.publishedAt}
                    className={cn(captionClass, "text-muted-foreground")}
                  >
                    {formatArticleDate(article.publishedAt)}
                  </time>
                )}
                {/* 読了目安。日付と同じ控えめなメタ表示に留める (本文へ入る前の
                    判断材料であって、見出しの一部ではないため)。 */}
                {readMinutes && (
                  <span className={cn(captionClass, "text-muted-foreground")}>
                    {t("readTime", { minutes: readMinutes })}
                  </span>
                )}
                {isGated && (
                  <span className={cn(captionClass, "text-muted-foreground")}>
                    [{tCommon("memberOnly")}]
                  </span>
                )}
              </div>
            ) : null}
          </header>

          {/* lead — 明朝 (Figma 8074:44859)。font ショートハンドを先に、family を
              後に当てるためインライン style で順序を固定する (どちらもトークン参照)。 */}
          {article.excerpt && (
            <p
              className="mt-6 text-foreground"
              style={{
                font: "var(--typography-style-body-lg)",
                fontFamily: "var(--typography-family-special)",
              }}
            >
              {article.excerpt}
            </p>
          )}

          {/* 冒頭写真 — 本文カラムから両側 40px はみ出す (SP は全幅) */}
          {article.mainImage?.asset && (
            <div className="mt-6 -mx-4 lg:-mx-10">
              <ImageCard
                className="[--bleed-ar:3/2] lg:[--bleed-ar:5/3] rounded-none lg:rounded-md"
                style={{ aspectRatio: "var(--bleed-ar)" }}
              >
                <Image
                  src={urlFor(article.mainImage).width(1440).url()}
                  alt={article.mainImage.alt || article.title}
                  width={1440}
                  height={864}
                  sizes="(max-width: 1024px) 100vw, 720px"
                  className="h-full w-full object-cover"
                  priority
                />
              </ImageCard>
            </div>
          )}

          {hasAccess ? (
            <>
              {/* 本文 — 段落間 24 / H2 前 56 後 20 (Figma の縦リズム)

                  枠は共有の `ArticleProse` を使う。ここは以前 `prose-custom` という
                  クラス名を書いていたが、**そのクラスは globals.css にも dist にも
                  一度も存在したことがない** (git 全履歴の *.css を `.prose-custom`
                  で検索して 0 件)。つまり枠として何も効いておらず、
                  - 段落が DS の body プリセット (16 / lh 1.75) ではなく共有
                    シリアライザの `text-sm` (14) のままだった
                  - `globals.css` の `[data-slot="article-prose"] h2` (PC で節見出しを
                    jp/h1 32 に上げる規則) が当たらず PC でも 24 のままだった
                  という 2 点で、同じ blockContent を出す elxea Journal 記事詳細
                  (`ArticleProse` 使用) と体裁が食い違っていた。
                  旧コメントにあった「`prose-custom` 自身が持つ段落マージン (実測
                  74px)」も、存在しないクラスについての記述なので削除した。

                  縦リズムは `ArticleProse` の既定 (節見出し 前 80 / 後 44) を
                  そのまま使う。ここは一度 `[&_h2]:mt-14!` / `[&_h2+*]:mt-5!` で
                  56 / 20 に上書きしていたが、**Figma 実測で 80 / 44 が正だと確定した**
                  ので上書きを外した。

                  Figma (`AWLnI0XF07e8rScuxPYPc7`) の本文カラム `Column 640` は
                  VERTICAL auto-layout の `itemSpacing: 24`。節見出しはその中に置かれた
                  **高さ 114 のフレーム `H2 (前56/後20)`** (8110:46909) で、内訳は
                  上パディング 56 + 見出しテキスト 38 + 下パディング 20 = 114。
                  つまり「前 56 / 後 20」はフレーム内パディングであって、
                  **文字から文字までの実距離は 24 + 56 = 80 / 20 + 24 = 44**。
                  REST の絶対座標でも一致する (直前画像の下端 15002 → 見出しテキスト上端
                  15082 = 80、見出し下端 15120 → 次テキスト上端 15164 = 44)。
                  旧コードの 56 / 20 はフレーム内パディングの数字をそのまま margin に
                  読み替えたもので、実距離が 24px ずつ足りていなかった。 */}
              {article.body && (
                <ArticleProse className="mt-6">
                  <PortableText value={article.body} />
                </ArticleProse>
              )}

              {/* 記事の音声 — サイト内で鳴らす (Setaka 確定 2026-08-11)。
                  `audioUrl` は「この記事の音源」なので、楽曲用ではなく
                  インタビュー用の AudioBlock (Figma 8174:63) で出す。楽曲用の
                  ジャケット + 曲リスト版はプレイリスト側 (tracks を持つ) の器で、
                  記事スキーマは曲配列を持たないため。BGM とは自動で排他になる。 */}
              {article.audioUrl && (
                <AudioBlock
                  variant="interview"
                  contentId={slug}
                  src={article.audioUrl}
                  kicker={t("audioInterviewLabel")}
                  title={article.title}
                  meta={author ? t("writtenBy") + ": " + author.name : undefined}
                  href={`/${locale}/journal/${slug}`}
                  labels={audioLabels}
                />
              )}

              {/* 動画などの外部リンク。音声は上の AudioBlock で鳴らすので、
                  ここは「サイト内で再生しない外部メディア」への導線に絞る。 */}
              {article.audioVideoUrl && (
                <div className="mt-6 rounded-lg border border-border p-4">
                  <p className={cn(overlineClass, "text-muted-foreground")}>{t("media")}</p>
                  <a
                    href={article.audioVideoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(bodySmClass, "mt-2 block underline underline-offset-2")}
                  >
                    {article.audioVideoUrl}
                  </a>
                </div>
              )}

              {/* この記事に合わせたい茶葉 (商品連動のある記事のみ)。
                  行を押すとページを離れずに茶葉詳細モーダルが開く
                  (Figma Modal 8172:280 + 中身スロット 8184:365)。
                  スペックと「さらに潜る」本文は Shopify のメタフィールドに
                  実在する項目だけを渡す — 無い項目は行ごと出さない。 */}
              <TeaDetailSection
                heading={t("teaInArticle")}
                labels={{
                  kicker: t("teaInArticle"),
                  close: t("close"),
                  toProduct: t("toProduct"),
                }}
                teas={relatedProducts.map((product) => ({
                  id: product.id,
                  title: product.title,
                  href: `/products/${product.handle}`,
                  imageUrl: product.featuredImage?.url,
                  meta: product.productType || undefined,
                  description: product.description || undefined,
                  spec: [
                    { label: t("teaSpecNo"), value: product.metafields?.menuNumber },
                    {
                      label: t("teaSpecCategory"),
                      value: product.metafields?.teaCategory || product.productType,
                    },
                    { label: t("teaSpecName"), value: product.title },
                    { label: t("teaSpecVariety"), value: product.metafields?.variety },
                    { label: t("teaSpecSeason"), value: product.metafields?.season },
                  ].filter((row): row is { label: string; value: string } => Boolean(row.value)),
                  details: [
                    {
                      id: "how-to-enjoy",
                      label: t("teaDetailHowToEnjoy"),
                      body: product.metafields?.howToEnjoy,
                    },
                    {
                      id: "taste",
                      label: t("teaDetailTaste"),
                      body: [product.metafields?.taste, product.metafields?.aroma]
                        .filter(Boolean)
                        .join(" / "),
                    },
                  ].filter(
                    (row): row is { id: string; label: string; body: string } => Boolean(row.body)
                  ),
                }))}
              />

              {/* 著者プロフィール */}
              {author && <AuthorProfile author={author} writtenByLabel={t("writtenBy")} />}

              {/* この号のほかの読みもの — 行 72 / サムネ 56 (Figma 8175:364)。
                  行を押すと即遷移せずモーダルが開き、フッターの主導線で初めて
                  記事へ移動する。モーダルの中では対象を乗り換えられるので、
                  「関連記事を開く → 戻る → 読了位置を失う」が起きない。 */}
              <RelatedReadingsSection
                heading={t("otherReadings")}
                labels={{
                  kicker: t("otherReadings"),
                  close: t("close"),
                  open: t("openThisReading"),
                  onlyOne: t("onlyOneReading"),
                }}
                readings={relatedArticles.slice(0, 3).map((related) => {
                  const image = related.thumbnail ?? related.mainImage;
                  return {
                    id: related._id,
                    title: related.title,
                    href: `/journal/${related.slug.current}`,
                    imageUrl: image?.asset
                      ? urlFor(image).width(112).height(112).url()
                      : undefined,
                  };
                })}
              />

              {/* NextRead — 行き止まりを作らない (カテゴリ回遊) */}
              {article.category?.slug?.current && (
                <div className="mt-6 flex justify-center">
                  {/* 手組みの pill を DS 部品 (Figma 8171:286) へ寄せる。 */}
                  <Link
                    href={`/journal?category=${article.category.slug.current}`}
                    className={pillClass("outline")}
                  >
                    {t("moreInCategory", { name: article.category.title })}
                  </Link>
                </div>
              )}

              {/* コメントは一旦撤去 (Setaka 判断 2026-08-11 / D1)。Figma 記事詳細
                  R2 にコメント UI が無く、実装だけが先行していたため表示を外す。
                  復活手順: `CommentSection` (components/community/comment-section)
                  を import し、farmers/[slug]/page.tsx と同じ i18n prop
                  (`getTranslations("comment")`) を渡してここに置き直す。
                  コンポーネント本体・API・翻訳キーはすべて残してある。 */}
            </>
          ) : (
            <MemberGate requiredTier={requiredTier} />
          )}
        </article>
      </Section>
    </>
  );
}
