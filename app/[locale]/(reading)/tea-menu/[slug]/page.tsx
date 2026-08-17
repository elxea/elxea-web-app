import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { PortableTextBlock } from "@portabletext/types";

import { getClient } from "@/sanity/lib/client";
import { TEA_MENU_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Link } from "@/i18n/navigation";
import { PortableText } from "@/components/sanity/portable-text";
import { ImageCard } from "@/components/media/image-card";
import { Breadcrumb } from "@/components/seo/breadcrumb";
import { TeaOriginBlock } from "@/components/viz/map/tea-origin-block";
import { resolveTeaOriginPlace } from "@/lib/roji/tea-origins";
import { isFictionalSlug } from "@/lib/fictional-content";
import { Button } from "@/components/ui/button";
import {
  bodySmClass,
  captionClass,
  h4Class,
  overlineClass,
} from "@/components/editorial/rule-list";
import {
  PageSection,
  SectionBody,
  SectionHead,
  SpecBand,
  type SpecItem,
} from "@/components/editorial/section-blocks";
import { formatNetWeight, type NetWeightValue } from "@/lib/format-net-weight";
import { seedTeaMenuDetail } from "@/lib/preview-seed";
import { cn } from "@/lib/utils";

/**
 * お茶メニュー詳細 — Figma【R2: 確定版】EC 系詳細の節骨格で実装。
 *
 * ## この画面に R2 確定版フレームが無いことの扱い (C9-1 の判断)
 * Structure List「お茶メニュー詳細」(https://app.notion.com/36b70c9d064c8159915bca38ddc7965d)
 * の `ステータス：Design` は **Not started** で、`Figma` プロパティが指す
 * `6654:13189` は R1 世代の「お茶メニュー詳細 変A（部品ベース）」だった
 * (旧 elxea ブランドの Header/Footer Module を含む)。R2 確定版セクションを
 * 3 ページ (7567:2 EC / 7567:4 Journal / 7567:6 Event) 全数走査してもこの画面は無い。
 *
 * よって**確定済みの兄弟テンプレから導出**する:
 * - 構造の正本 = 商品詳細【R2: 確定版】PC `8056:1517` / SP `8057:1700` の節骨格
 *   (同じ Figma ページ 7567:2 = EC 系。`components/editorial/section-blocks.tsx`
 *   がその実測値を体現している)
 * - 内容モデル・ラベルの正本 = 変A `6654:13189`
 *   (お茶の詳細 4 項目 / 淹れ方ガイド 3 項目 / 購入 / 関連記事)
 *
 * Figma 実測 (px) → 実装の対応:
 * - 節上下余白        PC 64 / SP 32     → `PageSection` (`py-8 lg:py-16`)
 * - 見出し overline→title PC 8 / SP 20 → `SectionHead`
 * - 見出し→本体       PC 32 / SP 20     → `SectionBody`
 * - スペック帯        PC 4列 304 gap32 / SP 2列 163.5 gap16 → `SpecBand`
 * - hero 2 カラム     変A 560 + gap64 + 656 → `lg:grid-cols-2 lg:gap-x-16`
 * - hero 写真         変A PC 560x560 / SP 358x340 → `aspectRatio="1/1"`
 * - 購入ボタン        変A PC 88x36 / SP 358x36 → DS Button 既定 size (h36) + `w-full lg:w-auto`
 *
 * データが無い節は枠ごと出さない (C4-2 PDP / C4-3 / 農家詳細と同じ方針)。
 * 変A では値が空でもスペック 4 行が常時出ていたが、これは是正する。
 *
 * 生 px・生カラーは書かない。文字組みは `typography.style.*` トークン
 * (rule-list からの再輸出)、色は semantic token、寸法は Tailwind spacing scale。
 */

type TeaMenu = {
  _id?: string;
  displayName: string;
  slug?: { current: string };
  productNumber?: string;
  category?: string;
  variety?: string;
  origin?: string;
  season?: string;
  /** 実データは文字列 `"50g"` / schema どおりの数値 `50` の両方があり得る。 */
  netWeight?: NetWeightValue;
  photo?: { asset: object; alt?: string };
  imageUrl?: string;
  description?: string | PortableTextBlock[];
  color?: string;
  brewingGuide?: { temperature?: string; water?: string; time?: string };
  relatedArticle?: { title: string; slug: { current: string } };
  shopifyHandle?: string;
  seo?: { title?: string; description?: string };
};

/** 値が入っている行だけ残す (データが無い節・行は出さない方針)。 */
function presentSpecs(
  rows: readonly { term: string; value?: string | null }[]
): SpecItem[] {
  return rows.filter(
    (row): row is { term: string; value: string } => Boolean(row.value)
  );
}

async function fetchTea(slug: string, locale: string): Promise<TeaMenu | null> {
  const client = getClient();
  const tea: TeaMenu | null = await client.fetch(TEA_MENU_BY_SLUG_QUERY, {
    slug,
    language: locale,
  });
  // Preview 限定: production dataset に該当のお茶が無いと確定版の節を実寸計測
  // できないため、見本を返す。フラグ未設定なら null なので production は無影響。
  return tea ?? seedTeaMenuDetail(slug);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  if (isFictionalSlug("teaMenu", slug)) return {};
  try {
    const tea = await fetchTea(slug, locale);
    if (!tea) return {};
    const title = tea.seo?.title || tea.displayName;
    const description =
      tea.seo?.description ||
      (typeof tea.description === "string" ? tea.description.slice(0, 160) : undefined);
    const image = tea.photo?.asset ? urlFor(tea.photo).width(800).url() : tea.imageUrl;
    return {
      title,
      description,
      openGraph: { title, description, images: image ? [{ url: image }] : [] },
    };
  } catch {
    return {};
  }
}

export default async function TeaMenuDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("teaMenu");
  const bt = await getTranslations("breadcrumb");

  // 架空・シードのお茶メニューは「文書が存在しない」扱いにする (#66)。
  if (isFictionalSlug("teaMenu", slug)) notFound();

  let tea: TeaMenu | null;
  try {
    tea = await fetchTea(slug, locale);
  } catch {
    return (
      <div className="page-container py-16">
        <p className={cn(bodySmClass, "text-muted-foreground")}>{t("loadError")}</p>
      </div>
    );
  }

  if (!tea) notFound();

  const heroImage =
    tea.imageUrl ??
    (tea.photo?.asset ? urlFor(tea.photo).width(800).height(800).url() : undefined);

  /** 変A `6654:13244` Spec Table の 4 行。値が無い行は落とす。 */
  const specItems = presentSpecs([
    { term: t("variety"), value: tea.variety },
    { term: t("origin"), value: tea.origin },
    { term: t("season"), value: tea.season },
    {
      term: t("netWeight"),
      // 内容量は数値 `50` と文字列 `"50g"` の両方が実データに入っている。
      // 単位付けは `formatNetWeight` に集約する (素で `g` を足すと `50gg`)。
      value: formatNetWeight(tea.netWeight),
    },
  ]);

  /** 変A `6654:13259` Brewing List の 3 行。値が無い行は落とす。 */
  const brewItems = presentSpecs([
    { term: t("temperature"), value: tea.brewingGuide?.temperature },
    { term: t("water"), value: tea.brewingGuide?.water },
    { term: t("time"), value: tea.brewingGuide?.time },
  ]);

  /**
   * 産地の地図の代替テキスト。地図の中に文字を置かない設計なので、
   * 地図が何を指しているかはここでしか伝わらない。
   *
   * 産地が引けない銘柄では `TeaOriginBlock` がブロックごと描かないため、
   * この文字列は使われずに捨てられる (先に組み立てても害はない)。
   */
  const originPlace =
    tea.productNumber === null || tea.productNumber === undefined
      ? null
      : resolveTeaOriginPlace(String(tea.productNumber));
  const originMapLabel = originPlace
    ? t("originMapAlt", { place: originPlace })
    : t("originMapAltUnknown");

  return (
    <>
      <div className="page-container pt-6">
        <Breadcrumb
          locale={locale}
          className="mb-0"
          items={[
            { label: bt("home"), href: "/" },
            { label: t("title"), href: "/tea-menu" },
            { label: tea.displayName },
          ]}
        />
      </div>

      {/* Hero — 変A 6654:13234 / 6656:7944 (写真 + 情報 2 カラム) */}
      <PageSection>
        <div className="lg:grid lg:grid-cols-2 lg:gap-x-16">
          <ImageCard
            image={heroImage}
            alt={tea.photo?.alt || tea.displayName}
            aspectRatio="1/1"
            width={800}
            height={800}
            sizes="(max-width: 1024px) 100vw, 50vw"
            style={tea.color ? { backgroundColor: tea.color } : undefined}
            priority
          />

          {/* 変A の Info Column は写真の上端に揃う (中央寄せではない)。
              段間はいずれも 24 (`mt-6`)。SP は写真の下に 20 で積む
              (変A 6656:7944 = 写真下端 340 → Info Column y360)。 */}
          <div data-slot="tea-hero-info" className="mt-5 lg:mt-0">
            {tea.category ? (
              <p className={cn(overlineClass, "text-muted-foreground")}>{tea.category}</p>
            ) : null}
            {/* ページ主見出しは 44px display の全体裁定 (`.page-title`) に従う。
                変A は jp/h1 (32px) だが、C4-2 / C4-3 / 農家詳細と同じ扱いにする。 */}
            <h1 className={cn("page-title text-foreground", tea.category && "mt-6")}>
              {tea.displayName}
            </h1>
            {tea.productNumber ? (
              <p className={cn(captionClass, "mt-6 text-muted-foreground")}>
                No. {tea.productNumber}
              </p>
            ) : null}
            {tea.description ? (
              <div className={cn(bodySmClass, "mt-6 text-foreground")}>
                {typeof tea.description === "string" ? (
                  <p>{tea.description}</p>
                ) : (
                  <PortableText value={tea.description} />
                )}
              </div>
            ) : null}
          </div>
        </div>
      </PageSection>

      {/* お茶の詳細 — 変A 6654:13242 / 6656:7952 */}
      {specItems.length > 0 ? (
        <PageSection>
          <SectionHead overline="SPECIFICATION" title={t("details")} />
          <SectionBody>
            <SpecBand items={specItems} />
          </SectionBody>
        </PageSection>
      ) : null}

      {/* R1-A: 産地の地図。銘柄番号から座標が引けないときは自分で null を返す
          (ブロックごと描かない)。詳細表の「産地」(Sanity の自由記述) の直後に
          置き、同じ話題を文字 → 図の順で読ませる。
          節の余白・見出しは `PageSection` / `SectionHead` の確定版リズムに
          合わせるのではなく、`TeaOriginBlock` が自前の枠を持つ (main 由来の
          実装をそのまま使い、確定版の節骨格には手を入れない)。 */}
      <TeaOriginBlock
        menuNumber={tea.productNumber}
        heading={t("origin")}
        mapLabel={originMapLabel}
      />

      {/* 淹れ方ガイド — 変A 6654:13257 / 6656:7967 */}
      {brewItems.length > 0 ? (
        <PageSection>
          <SectionHead overline="HOW TO BREW" title={t("brewingGuide")} />
          <SectionBody>
            {/* 変A は値を大きく見せ SP は縦積みにする造作。専用部品を作らず
                `SpecBand` の emphasis variant で寄せる (Boss 裁定 2026-08-09・
                c9-1 注1h / 確認事項2)。枠線つきボックスは採らない (R2 の
                スペック帯と同じ罫線 1 本の系統を維持する)。 */}
            <SpecBand items={brewItems} emphasis />
          </SectionBody>
        </PageSection>
      ) : null}

      {/* 購入・関連記事 — 変A 6654:13269 / 6656:7979 (1 ブロックにまとめる) */}
      {tea.shopifyHandle || tea.relatedArticle ? (
        <PageSection>
          {tea.shopifyHandle ? (
            <div data-slot="tea-buy">
              <Button asChild className="w-full lg:w-auto">
                <Link href={`/products/${tea.shopifyHandle}`}>{t("buyNow")}</Link>
              </Button>
            </div>
          ) : null}

          {tea.relatedArticle ? (
            <div
              data-slot="tea-related-article"
              className={cn(tea.shopifyHandle && "mt-8")}
            >
              <p className={cn(overlineClass, "text-muted-foreground")}>
                {t("relatedArticle")}
              </p>
              <Link
                href={`/journal/${tea.relatedArticle.slug.current}`}
                className="group mt-4 flex items-center justify-between gap-4 border-t border-b border-border py-3"
              >
                <span
                  className={cn(
                    h4Class,
                    "text-foreground underline-offset-4 group-hover:underline"
                  )}
                >
                  {tea.relatedArticle.title}
                </span>
                <span
                  aria-hidden="true"
                  className="text-muted-foreground transition-transform group-hover:translate-x-1"
                >
                  →
                </span>
              </Link>
            </div>
          ) : null}
        </PageSection>
      ) : null}
    </>
  );
}
