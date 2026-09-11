import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { PortableTextBlock } from "@portabletext/types";

import { getClient } from "@/sanity/lib/client";
import {
  FARMER_BY_SLUG_QUERY,
  OTHER_FARMERS_QUERY,
} from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { AuthorByline } from "@/components/journal/author-byline";
import { ArticleProse } from "@/components/journal/article-blocks";
import { SpecBand } from "@/components/editorial/section-blocks";
import { PortableText } from "@/components/sanity/portable-text";
import { FavoriteToggleButton } from "@/components/favorites/favorite-toggle-button";
import { CommentSection } from "@/components/community/comment-section";
import {
  FarmerCardGrid,
  FarmerDataBand,
  FarmerHead,
  FarmerQuote,
  FarmerSection,
  FarmerSectionBody,
  FarmerSectionHead,
  InterviewList,
  ProcessGrid,
  farmerBandClass,
  type FarmerCardItem,
  type ProcessItem,
} from "@/components/farmers/farmer-detail";
import { filterOutFictional, isFictionalSlug } from "@/lib/fictional-content";
import {
  SEED_FARMER_TEAS,
  previewImageForKey,
  previewSeedEnabled,
  withSeedFarmerDetail,
} from "@/lib/preview-seed";
import { getProductByHandle } from "@/lib/shopify";
import { formatPrice } from "@/lib/utils";

/**
 * 農家詳細 — Figma【R2: 確定版】People 詳細テンプレ統合 (茶園セクション拡張)
 * (PC 8079:3748 / SP 8079:3966) の実装。
 *
 * 確定版の 9 ブロック構成をそのまま節にする:
 *   1. FarmerHead     写真 + 氏名 + 肩書 + メタ + 実数 + 聞き手クレジット
 *   2. Quote          反転面・本人の一言
 *   3. THE WORK       手仕事の工程
 *   4. INTERVIEW      一問一答 (本文幅 640 / サイドバー無し)
 *   5. PROFILE        4 カラムのデータ帯
 *   6. THE FIELD      茶園データ帯
 *   7. THE FIELD      茶園の一年
 *   8. TEAS           このひとが育てたお茶 (購入導線は最下部・価格のみ)
 *   9. OTHER PEOPLE   ほかの人をたずねる
 *
 * データが無い節は枠ごと出さない (空枠を出さない方針 — C4-2 PDP / C4-3 と同じ)。
 * 3〜8 は C4-4a で Sanity schema に追加したフィールド (`work` / `interview` /
 * `profileBand` / `fieldBand` / `fieldSeasons` / `relatedProducts`) を唯一の根拠に
 * する。
 *
 * 確定版に枠が無いが実装に残すもの (意図的差分):
 * - `bio` (紹介文) …… 既存データを落とさないため INTERVIEW の下に読み物として置く
 * - FollowButton / CommentSection …… Figma 非掲載だが既存機能なので最下部に残す
 *   (header の AudioToggle と同じ扱い)
 */

type AuthorRef = {
  name: string;
  role?: string;
  image?: { asset: object; alt?: string };
};

type PhotoRef = { asset: object; alt?: string };

type ProcessStep = {
  name: string;
  description?: string;
  photo?: PhotoRef;
};

type BandRow = { label: string; value: string };

type Farmer = {
  _id: string;
  name: string;
  slug: { current: string };
  photo?: PhotoRef;
  region?: string;
  country?: string;
  bio?: PortableTextBlock[];
  relatedProducts?: string[];
  kicker?: string;
  role?: string;
  meta?: string;
  stats?: { value: string; label: string }[];
  interviewer?: AuthorRef;
  quote?: string;
  quoteBy?: string;
  workHead?: string;
  work?: ProcessStep[];
  interview?: { question: string; answer: string }[];
  profileBand?: BandRow[];
  fieldBand?: BandRow[];
  fieldHead?: string;
  fieldSeasons?: ProcessStep[];
  teasHead?: string;
};

type OtherFarmer = {
  _id: string;
  name: string;
  slug: { current: string };
  photo?: PhotoRef;
  role?: string;
  region?: string;
  country?: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  // Fictional/seed farmers are hidden until real stories are approved.
  if (isFictionalSlug("farmer", slug)) return {};
  try {
    const client = getClient();
    const farmer: Farmer | null = await client.fetch(FARMER_BY_SLUG_QUERY, {
      slug,
      language: locale,
    });
    if (!farmer) return {};
    const image = farmer.photo?.asset
      ? urlFor(farmer.photo).width(800).url()
      : undefined;
    const location = [farmer.region, farmer.country].filter(Boolean).join(", ");
    return {
      title: farmer.name,
      description: farmer.meta || farmer.role || location || farmer.name,
      openGraph: {
        title: farmer.name,
        images: image ? [{ url: image }] : [],
      },
    };
  } catch {
    return {};
  }
}

/** 写真つきカードの画像 URL。プレビュー時のみプレースホルダを補う。 */
function photoUrl(
  photo: PhotoRef | undefined,
  seedKey: string,
  width: number,
  height: number
): string | undefined {
  if (photo?.asset) return urlFor(photo).width(width).height(height).url();
  return previewSeedEnabled() ? previewImageForKey(seedKey) : undefined;
}

/** THE WORK / 茶園の一年 は同じ「番号つき工程」型なので整形も共通にする。 */
function toProcessItems(
  steps: ProcessStep[] | undefined,
  keyPrefix: string
): ProcessItem[] {
  return (steps ?? []).map((step, i) => ({
    key: `${keyPrefix}-${i}`,
    no: String(i + 1).padStart(2, "0"),
    name: step.name,
    description: step.description,
    image: photoUrl(step.photo, `${keyPrefix}-${i}`, 416, 312),
    imageAlt: step.photo?.alt ?? step.name,
  }));
}

export default async function FarmerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("farmer");
  const bt = await getTranslations("breadcrumb");
  const tCommon = await getTranslations("common");
  const tComment = await getTranslations("comment");

  // Fictional/seed farmers are hidden until real stories are approved:
  // return 404 instead of rendering an invented profile. No Sanity mutation.
  if (isFictionalSlug("farmer", slug)) notFound();

  let farmer: Farmer | null;
  let others: OtherFarmer[] = [];
  try {
    const client = getClient();
    farmer = await client.fetch(FARMER_BY_SLUG_QUERY, { slug, language: locale });
    if (farmer) {
      const fetched: OtherFarmer[] =
        (await client.fetch(OTHER_FARMERS_QUERY, { slug, language: locale })) ??
        [];
      others = filterOutFictional("farmer", fetched);
    }
  } catch {
    return (
      <div className="page-container py-16">
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!farmer) notFound();

  // Preview-only: production dataset の farmer はまだ R2 の節フィールドを持たない
  // ため、フラグが立っているときだけ未入力欄を見本で埋めてレイアウトを実寸で
  // 確認できるようにする。フラグ未設定時は byte-identical (何も足さない)。
  farmer = withSeedFarmerDetail(farmer);

  /* --- 1. FarmerHead ------------------------------------------------------ */

  const heroImage = photoUrl(farmer.photo, farmer._id, 640, 800);
  const location = [farmer.region, farmer.country].filter(Boolean).join(", ");
  const stats = farmer.stats ?? [];

  /* --- 3 / 7. 番号つき工程 ------------------------------------------------ */

  const workItems = toProcessItems(farmer.work, "work");
  const seasonItems = toProcessItems(farmer.fieldSeasons, "season");

  /* --- 4. INTERVIEW ------------------------------------------------------- */

  const interviewItems = (farmer.interview ?? []).map((row, i) => ({
    no: `${t("questionPrefix")} ${String(i + 1).padStart(2, "0")}`,
    question: row.question,
    answer: row.answer,
  }));

  /* --- 8. このひとが育てたお茶 (Shopify) ---------------------------------- */

  const teaProducts = (
    await Promise.all(
      (farmer.relatedProducts ?? []).slice(0, 3).map(async (handle) => {
        try {
          return await getProductByHandle(handle);
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);

  const resolvedTeaItems: FarmerCardItem[] = teaProducts.map((product) => {
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

  // Preview-only: ハンドル未設定 / 解決不能のときだけ見本カードを出す。
  const teaItems: FarmerCardItem[] =
    resolvedTeaItems.length > 0 || !previewSeedEnabled()
      ? resolvedTeaItems
      : SEED_FARMER_TEAS.map((tea, i) => ({
          key: `seed-tea-${i}`,
          image: previewImageForKey(`seed-tea-${i}`),
          imageAlt: tea.title,
          title: tea.title,
          note: tea.note,
          meta: tea.price,
        }));

  /* --- 9. ほかの人をたずねる ---------------------------------------------- */

  const otherItems: FarmerCardItem[] = others.map((other) => ({
    key: other._id,
    href: `/farmers/${other.slug.current}`,
    image: photoUrl(other.photo, other._id, 416, 260),
    imageAlt: other.photo?.alt ?? other.name,
    title: other.name,
    note:
      other.role || [other.region, other.country].filter(Boolean).join(", ") ||
      undefined,
  }));

  return (
    <>
      <FarmerHead
        overline={farmer.kicker || t("kickerDefault")}
        title={farmer.name}
        role={farmer.role}
        meta={farmer.meta || location || undefined}
        image={heroImage}
        imageAlt={farmer.photo?.alt ?? farmer.name}
        stats={stats}
        bylineLabel={farmer.interviewer ? t("interviewerLabel") : undefined}
        byline={
          farmer.interviewer ? (
            <AuthorByline
              name={farmer.interviewer.name}
              role={farmer.interviewer.role}
              avatarUrl={
                farmer.interviewer.image?.asset
                  ? urlFor(farmer.interviewer.image).width(64).height(64).url()
                  : undefined
              }
            />
          ) : undefined
        }
      >
        {/* 農家一覧 (/farmers) は 2026-08-14 に廃止したので、中間の階層を持たず
            トップ直下に置く。存在しない URL をパンくずに残すと 404 へ誘導し、
            BreadcrumbList 構造化データにも死んだ URL が載るため。 */}
        <Breadcrumb
          items={[
            { label: bt("home"), href: "/" },
            { label: farmer.name },
          ]}
          locale={locale}
        />
      </FarmerHead>

      {farmer.quote ? (
        <FarmerQuote quote={farmer.quote} attribution={farmer.quoteBy} />
      ) : null}

      {workItems.length > 0 ? (
        <FarmerSection>
          <FarmerSectionHead
            overline={t("workKicker")}
            title={farmer.workHead}
          />
          <FarmerSectionBody>
            <ProcessGrid items={workItems} />
          </FarmerSectionBody>
        </FarmerSection>
      ) : null}

      {interviewItems.length > 0 ? (
        <FarmerSection>
          <FarmerSectionHead
            overline={t("interviewKicker")}
            title={t("interviewHead")}
          />
          {/* Figma の INTERVIEW だけ見出し → 本体が PC 76 (他の節は 52)。 */}
          <FarmerSectionBody className="lg:mt-19">
            <InterviewList items={interviewItems} />
          </FarmerSectionBody>
        </FarmerSection>
      ) : null}

      {/* 確定版に枠は無いが、既存の紹介文を落とさないため読み物として残す。 */}
      {farmer.bio ? (
        <FarmerSection>
          {/* 枠は共有の `ArticleProse`。以前は `prose-custom` と書いていたが
              そのクラスは CSS に一度も存在せず (git 全履歴で 0 件)、段落が DS の
              body プリセットではなく共有シリアライザの `text-sm` のままだった。 */}
          <ArticleProse className="max-w-160">
            <PortableText value={farmer.bio} />
          </ArticleProse>
        </FarmerSection>
      ) : null}

      {farmer.profileBand && farmer.profileBand.length > 0 ? (
        <FarmerDataBand>
          <div className="page-container pt-16 pb-27 lg:pt-24">
            <FarmerSectionHead overline={t("profileKicker")} />
            <SpecBand
              className={farmerBandClass}
              items={farmer.profileBand.map((row) => ({
                term: row.label,
                value: row.value,
              }))}
            />
          </div>
        </FarmerDataBand>
      ) : null}

      {farmer.fieldBand && farmer.fieldBand.length > 0 ? (
        <FarmerDataBand>
          <div className="page-container pt-16 pb-27 lg:pt-24">
            <FarmerSectionHead overline={t("fieldKicker")} />
            <SpecBand
              className={farmerBandClass}
              items={farmer.fieldBand.map((row) => ({
                term: row.label,
                value: row.value,
              }))}
            />
          </div>
        </FarmerDataBand>
      ) : null}

      {seasonItems.length > 0 ? (
        <FarmerSection>
          <FarmerSectionHead
            overline={t("fieldKicker")}
            title={farmer.fieldHead}
          />
          <FarmerSectionBody>
            <ProcessGrid items={seasonItems} />
          </FarmerSectionBody>
        </FarmerSection>
      ) : null}

      {teaItems.length > 0 ? (
        <FarmerSection>
          <FarmerSectionHead
            overline={t("teasKicker")}
            title={farmer.teasHead}
          />
          <FarmerSectionBody>
            <FarmerCardGrid items={teaItems} />
          </FarmerSectionBody>
        </FarmerSection>
      ) : null}

      {otherItems.length > 0 ? (
        <FarmerSection>
          <FarmerSectionHead
            overline={t("otherKicker")}
            title={t("otherHead")}
          />
          <FarmerSectionBody>
            <FarmerCardGrid items={otherItems} noteScale="caption" />
          </FarmerSectionBody>
        </FarmerSection>
      ) : null}

      {/* 以下は Figma 確定版に枠が無い既存機能 (意図的差分)。購入導線より後に
          置き、読み物としての流れを壊さない。 */}
      <FarmerSection>
        {/* 農家も「お気に入り」の 4 分類目 (J-5 決裁)。以前ここは「フォローする」
            という別の動詞・別のコレクションだった。動詞も保存先も部品も、他の
            3 種類と同じにする。 */}
        <FavoriteToggleButton
          kind="farmer"
          targetId={slug}
          title={farmer.name}
          imageUrl={
            farmer.photo?.asset
              ? urlFor(farmer.photo).width(80).height(80).url()
              : null
          }
          appearance="panel"
          labels={{
            add: t("follow"),
            remove: t("unfollow"),
            saved: t("followSaved"),
            added: t("followedMessage"),
            removed: t("unfollowedMessage"),
            error: tCommon("error"),
            loginRequiredMessage: tCommon("loginRequired"),
          }}
        />
      </FarmerSection>

      <CommentSection
        targetType="farmer"
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
  );
}
