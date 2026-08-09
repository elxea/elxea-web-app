import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { getClient } from "@/sanity/lib/client";
import {
  AUTHOR_BY_SLUG_QUERY,
  ARTICLES_BY_AUTHOR_QUERY,
} from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { bodySmClass } from "@/components/editorial/rule-list";
import { CatalogGrid } from "@/components/catalog/catalog-list";
import { ArticleCard } from "@/components/journal/article-card";
import {
  AuthorHead,
  AuthorSection,
  AuthorSectionBody,
  AuthorSectionHead,
  type AuthorStat,
} from "@/components/journal/author-detail";
import {
  previewImageForKey,
  previewSeedEnabled,
  withSeedAuthorDetail,
} from "@/lib/preview-seed";
import { cn } from "@/lib/utils";

/**
 * 著者ページ — Figma の凍結決定「【廃止: People 詳細へ統合】 ジャーナル:著者」
 * (section `7805:1952`) に従い、**People 詳細テンプレ** (section `7822:37212`
 * 「【採用: 作り手の共通テンプレ】 People 詳細」/ PC `7822:37213` /
 * SP `7823:37542`) の 2 ブロック構成で組む。
 *
 * 著者ページ専用の R2 確定版フレームは Figma に存在しない (全 155 件の
 * R2 / 確定版ノードを全数走査して確認済み)。専用画面は凍結時に廃止され、
 * テンプレ統合が決定事項なので、C9-1 と同じ「凍結済み兄弟 R2 から導出」の
 * 作法で実装する。導出元の R2 確定版適用例は 農家詳細 (PC `8079:3748` /
 * SP `8079:3966`) と プレイリスト詳細 (PC `8089:4518` / SP `8089:4622`)。
 *
 * 構成 (テンプレの節をこのページが持てるデータだけに絞る):
 *   1. AuthorHead  ポートレート (4:5) + AUTHOR キッカー + 氏名 + 肩書 +
 *                  紹介文 + 実数 (ARTICLES / SINCE) + 外部リンク
 *   2. ARTICLES    この人の記事 (一覧と同じ ArticleCard / 2 列グリッド)
 *
 * データが無い節は枠ごと出さない (空枠を出さない方針 — C4-2 PDP / C4-3 /
 * C4-4a と同じ)。実数 (ARTICLES / SINCE) も記事が 1 本も無ければ罫線ごと出さない。
 *
 * テンプレに枠があるがこのページでは出さないもの (意図的差分):
 * - Quote / THE WORK / INTERVIEW / データ帯 …… `author` スキーマに対応する
 *   フィールドが無い。Figma 側に枠を足して凍結してからコードに生やす
 *   (先にコードで生やさない — C4-2R の裁定と同じ)。
 * - 「聞き手」クレジット …… 著者本人のページなので聞き手の概念が無い。
 *   同じ位置 (byline 枠) は外部リンクに充てる。
 */

/** 実数 (ARTICLES / SINCE) を数えるための取得上限。 */
const ARTICLE_FETCH_LIMIT = 100;

/** 記事グリッドの表示件数 (一覧 R2 と同じ 2 列 x 3 段 = 6 件を 2 段ぶん)。 */
const GRID_LIMIT = 12;

type Author = {
  _id: string;
  name: string;
  slug?: { current: string };
  image?: { asset: object };
  role?: string;
  bio?: string;
  website?: string;
};

type ArticleItem = {
  _id: string;
  slug: { current: string };
  title: string;
  excerpt?: string;
  thumbnail?: { asset: object; alt?: string };
  mainImage?: { asset: object; alt?: string };
  publishedAt?: string;
  memberOnly?: boolean;
  category?: { title: string; slug: { current: string } };
  tags?: { _id: string; title: string; slug: { current: string } }[];
  author?: { name: string; image?: { asset: object } };
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const client = getClient();
    const author: Author | null = await client.fetch(AUTHOR_BY_SLUG_QUERY, { slug });
    if (!author) return {};
    const description = author.bio?.slice(0, 160) || author.name;
    const image = author.image?.asset
      ? urlFor(author.image).width(1200).url()
      : undefined;
    return {
      title: author.name,
      description,
      openGraph: {
        title: author.name,
        description,
        images: image ? [{ url: image }] : [],
      },
    };
  } catch {
    return {};
  }
}

export default async function AuthorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("journal");
  const tCommon = await getTranslations("common");
  const bt = await getTranslations("breadcrumb");

  let author: Author | null;
  let articles: ArticleItem[];
  try {
    const client = getClient();
    [author, articles] = await Promise.all([
      client.fetch(AUTHOR_BY_SLUG_QUERY, { slug }),
      client.fetch(ARTICLES_BY_AUTHOR_QUERY, {
        language: locale,
        authorSlug: slug,
        start: 0,
        end: ARTICLE_FETCH_LIMIT,
      }),
    ]);
  } catch {
    return (
      <AuthorSection>
        <p className={cn(bodySmClass, "text-muted-foreground")}>{t("loadError")}</p>
      </AuthorSection>
    );
  }

  if (!author) notFound();

  // Preview-only: production dataset の author は role / bio / website を
  // どれも入力していないため、フラグが立っているときだけ未入力欄を見本で埋めて
  // 確定版の縦リズムを実寸で確認できるようにする。フラグ未設定時は
  // byte-identical (何も足さない)。
  author = withSeedAuthorDetail(author);

  const written = articles ?? [];

  /* --- 実数 (Figma テンプレ 7822:37270 の Stats) -------------------------- */

  // 記事が無ければ罫線ごと出さない。SINCE は最も古い記事の年 (取得は
  // publishedAt の降順なので末尾が最古)。日付が無い記事しかなければ出さない。
  const oldestYear = (() => {
    for (let i = written.length - 1; i >= 0; i -= 1) {
      const at = written[i]?.publishedAt;
      if (at) {
        const year = new Date(at).getFullYear();
        if (Number.isFinite(year)) return String(year);
      }
    }
    return undefined;
  })();

  const stats: AuthorStat[] = [];
  if (written.length > 0) {
    stats.push({ value: written.length, label: "ARTICLES" });
    if (oldestYear) stats.push({ value: oldestYear, label: "SINCE" });
  }

  /* --- ポートレート ------------------------------------------------------- */

  // Preview-only: 写真未設定の著者でも 4:5 の枠の密度を確認できるように
  // フラグが立っているときだけローカルのプレースホルダを充てる。
  const portrait = author.image?.asset
    ? urlFor(author.image).width(640).height(800).url()
    : previewSeedEnabled()
      ? previewImageForKey(author._id)
      : undefined;

  const visible = written.slice(0, GRID_LIMIT);

  return (
    <>
      <AuthorHead
        overline="AUTHOR"
        title={author.name}
        role={author.role}
        meta={author.bio}
        image={portrait}
        imageAlt={author.name}
        stats={stats}
        bylineLabel={author.website ? t("authorLinkLabel") : undefined}
        byline={
          author.website ? (
            <a
              href={author.website}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                bodySmClass,
                "text-foreground underline underline-offset-4 hover:text-muted-foreground"
              )}
            >
              {author.website.replace(/^https?:\/\//, "")}
            </a>
          ) : null
        }
      >
        <Breadcrumb
          items={[
            { label: bt("home"), href: "/" },
            { label: t("title"), href: "/journal" },
            { label: author.name },
          ]}
          locale={locale}
        />
      </AuthorHead>

      {visible.length > 0 ? (
        <AuthorSection>
          <AuthorSectionHead overline="ARTICLES" title={t("authorArticles")} />
          <AuthorSectionBody>
            {/* グリッドは People 詳細テンプレの札列 (PC 3 列 416 / gap-x 32 —
                Figma 7822:37492 / 37496 / 37500 の x=64 / 512 / 960) と
                R2 共通リストパターンの SP 2 列が一致する `CatalogGrid` を使う。
                サイドバーが無い節なので一覧の 2 列 (452) ではなく 3 列が正。 */}
            <CatalogGrid>
              {visible.map((article) => (
                <ArticleCard
                  key={article._id}
                  article={article}
                  memberOnlyLabel={tCommon("memberOnly")}
                  /* この帯は節見出し (`AuthorSectionHead` = h2「この人の記事」) を
                     持つので、カード見出しはその下位 = h3。体裁は変わらない
                     (globals.css の article-card-title は h2 / h3 同値)。 */
                  headingLevel="h3"
                />
              ))}
            </CatalogGrid>
          </AuthorSectionBody>
        </AuthorSection>
      ) : null}
    </>
  );
}
