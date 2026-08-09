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
import { ImageCard } from "@/components/ui/image-card";
import { MemberGate } from "@/components/ui/member-gate";
import {
  bodySmClass,
  captionClass,
  overlineClass,
} from "@/components/editorial/rule-list";
import { AuthorByline } from "@/components/journal/author-byline";
import { AuthorProfile } from "@/components/journal/author-profile";
import { BookmarkButton } from "@/components/journal/bookmark-button";
import { ArticleReadTracker } from "@/components/journal/article-read-tracker";
import { ReadingProgress } from "@/components/journal/reading-progress";
import { CommentSection } from "@/components/community/comment-section";
import { formatArticleDate } from "@/lib/format-date";
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
  const tComment = await getTranslations("comment");
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

  // 記事末尾の関連記事 (Figma は 3 行)
  let relatedArticles: RelatedArticle[] = [];
  if (hasAccess && article.category?._id) {
    try {
      const client = getClient();
      relatedArticles = await client.fetch(RELATED_ARTICLES_QUERY, {
        language: locale,
        currentId: article._id,
        categoryId: article.category._id,
        tagIds: article.tags?.map((tag: { _id: string }) => tag._id) ?? [],
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

  const author = article.author as ArticleAuthor | undefined;
  const authorAvatar = author?.image?.asset
    ? urlFor(author.image).width(64).height(64).url()
    : undefined;

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
                addedMessage={t("addedToBookmarks")}
                removedMessage={t("removedFromBookmarks")}
                errorMessage={t("bookmarkError")}
                loginRequiredMessage={t("loginRequiredForBookmark")}
                className="mt-1 shrink-0"
              />
            </div>
            {author ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                {author.slug?.current ? (
                  {/* C17-1: 著者ページは People 詳細へ統合 (Figma 7805:1952
                      「【廃止: People 詳細へ統合】 ジャーナル:著者」)。旧 URL は
                      next.config.ts の 308 で寄せてあるが、内部リンクは 1 ホップ
                      無駄に踏ませないよう直接 /people/[slug] を指す。 */}
                  <Link href={`/people/${author.slug.current}`}>
                    <AuthorByline name={author.name} role={author.role} avatarUrl={authorAvatar} />
                  </Link>
                ) : (
                  <AuthorByline name={author.name} role={author.role} avatarUrl={authorAvatar} />
                )}
                {article.publishedAt && (
                  <time
                    dateTime={article.publishedAt}
                    className={cn(captionClass, "text-muted-foreground")}
                  >
                    {formatArticleDate(article.publishedAt)}
                  </time>
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
              {/* 本文 — 段落間 24 / H2 前 56 後 20 (Figma の縦リズム) */}
              {/* 本文の縦リズム: `prose-custom` 自身が持つ段落マージン (実測
                  74px) は Figma の 24 と食い違うため important 付きで上書きする。
                  下マージンを 0 に倒し、間隔は隣接セレクタの上マージンだけで
                  作る (マージン相殺の影響を受けないようにするため)。
                  節見出しの「後 20」も同じ原則で見出し側の mb ではなく直後要素の
                  mt で作る (mb 20 と段落 mt 24 が相殺すると大きい 24 が勝ち、
                  実レンダリングが Figma 実測 20 とずれるため)。
                  `.prose-custom h2 + *` は型セレクタを含み `.prose-custom > * + *`
                  より詳細度が高いので、隣接段落の mt-6 を確実に上書きする。 */}
              {article.body && (
                <div className="prose-custom mt-6 [&>*]:mb-0! [&>*+*]:mt-6! [&_h2]:mt-14! [&_h2]:mb-0! [&_h3]:mt-14! [&_h3]:mb-0! [&_h2+*]:mt-5! [&_h3+*]:mt-5!">
                  <PortableText value={article.body} />
                </div>
              )}

              {/* 動画・音声 */}
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

              {/* この記事に合わせたい茶葉 (商品連動のある記事のみ) */}
              {relatedProducts.length > 0 && (
                <section className="mt-6">
                  <p className={cn(captionClass, "text-muted-foreground")}>{t("teaInArticle")}</p>
                  <ul className="mt-4 space-y-4">
                    {relatedProducts.map((product) => (
                      <li key={product.id} className="flex gap-4 lg:gap-6">
                        <div className="w-24 shrink-0 lg:w-40">
                          <ImageCard
                            image={product.featuredImage?.url}
                            alt={product.featuredImage?.altText ?? product.title}
                            style={{ aspectRatio: "1/1" }}
                          />
                        </div>
                        <div className="flex flex-col justify-center gap-2">
                          <p className="text-foreground">{product.title}</p>
                          {product.productType ? (
                            <p className={cn(captionClass, "hidden text-muted-foreground lg:block")}>
                              {product.productType}
                            </p>
                          ) : null}
                          <Link
                            href={`/products/${product.handle}`}
                            className={cn(
                              bodySmClass,
                              "flex h-12 items-center text-foreground underline-offset-4 hover:underline"
                            )}
                          >
                            {t("toProduct")}
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 著者プロフィール */}
              {author && <AuthorProfile author={author} writtenByLabel={t("writtenBy")} />}

              {/* 関連記事 — 記事末尾カード型 (行 72 / サムネ 56) */}
              {relatedArticles.length > 0 && (
                <section className="mt-6">
                  <p className={cn(captionClass, "text-muted-foreground")}>
                    {t("relatedArticles")}
                  </p>
                  <ul className="mt-2">
                    {relatedArticles.slice(0, 3).map((related) => {
                      const image = related.thumbnail ?? related.mainImage;
                      return (
                        <li key={related._id}>
                          <Link
                            href={`/journal/${related.slug.current}`}
                            className="flex h-18 items-center gap-4"
                          >
                            <div className="size-14 shrink-0">
                              <ImageCard
                                image={image?.asset ? urlFor(image).width(112).height(112).url() : undefined}
                                alt={related.title}
                                style={{ aspectRatio: "1/1" }}
                              />
                            </div>
                            <span
                              className={cn(
                                bodySmClass,
                                "text-foreground underline-offset-4 hover:underline"
                              )}
                            >
                              {related.title}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* NextRead — 行き止まりを作らない (カテゴリ回遊) */}
              {article.category?.slug?.current && (
                <div className="mt-6 flex justify-center">
                  <Link
                    href={`/journal?category=${article.category.slug.current}`}
                    className={cn(
                      bodySmClass,
                      "flex h-12 items-center rounded-full border border-border px-4 text-foreground transition-colors hover:bg-muted"
                    )}
                  >
                    {t("moreInCategory", { name: article.category.title })}
                  </Link>
                </div>
              )}

              {/* コメント */}
              <CommentSection
                targetType="article"
                targetId={slug}
                locale={locale}
                i18n={{
                  title: tComment("title"),
                  placeholder: tComment("placeholder"),
                  submit: tComment("submit"),
                  submitting: tComment("submitting"),
                  loginRequired: tComment("loginRequired"),
                  postedMessage: tComment("postedMessage"),
                  deletedMessage: tComment("deletedMessage"),
                  errorPosting: tComment("errorPosting"),
                  errorDeleting: tComment("errorDeleting"),
                  noComments: tComment("noComments"),
                  delete: tComment("delete"),
                  characterCount: tComment("characterCount"),
                  moderation: tComment("moderation"),
                }}
              />
            </>
          ) : (
            <MemberGate requiredTier={requiredTier} />
          )}
        </article>
      </Section>
    </>
  );
}
