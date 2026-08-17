import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
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
import type { PortableTextBlock } from "@portabletext/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  if (isFictionalSlug("teaMenu", slug)) return {};
  try {
    const client = getClient();
    const tea = await client.fetch(TEA_MENU_BY_SLUG_QUERY, { slug, language: locale });
    if (!tea) return {};
    const seo = tea.seo;
    const title = seo?.title || tea.displayName;
    const description = seo?.description || (typeof tea.description === "string" ? tea.description?.slice(0, 160) : undefined);
    const image = tea.photo?.asset ? urlFor(tea.photo).width(800).url() : undefined;
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
  const tCommon = await getTranslations("common");

  // Fictional/seed tea menu -> behave as if the document does not exist.
  if (isFictionalSlug("teaMenu", slug)) notFound();

  let tea;
  try {
    const client = getClient();
    tea = await client.fetch(TEA_MENU_BY_SLUG_QUERY, { slug, language: locale });
  } catch {
    return (
      <div className="section-narrow">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!tea) notFound();

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
    <div className="section-wide">
      {/* 変A: breadcrumb */}
      <Breadcrumb
        locale={locale}
        items={[
          { label: tCommon("home"), href: "/" },
          { label: tCommon("teaMenu"), href: "/tea-menu" },
          { label: tea.displayName },
        ]}
      />

      {/* 変A: 2カラム hero (写真左 / 情報右) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 mb-16 md:mb-24">
        <ImageCard
          image={tea.photo?.asset ? urlFor(tea.photo).width(800).height(533).url() : undefined}
          alt={tea.photo?.alt || tea.displayName}
          width={800}
          height={533}
          sizes="(max-width: 1024px) 100vw, 50vw"
          style={tea.color ? { backgroundColor: tea.color } : undefined}
          priority
        />

        <div className="flex flex-col justify-center">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-3">
            {tea.category}
          </p>
          <h1 className="mb-2">{tea.displayName}</h1>
          {tea.productNumber && (
            <p className="text-xs text-muted-foreground tracking-wider mb-6">
              No. {tea.productNumber}
            </p>
          )}

          {tea.description && (
            <div className="text-sm text-muted-foreground leading-relaxed">
              {typeof tea.description === "string" ? (
                <p>{tea.description}</p>
              ) : (
                <PortableText value={tea.description as PortableTextBlock[]} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* 変A: お茶の詳細 (全幅・罫線行テーブル) */}
      <section className="mb-16 md:mb-24 max-w-3xl">
        <h2 className="text-sm font-medium mb-6">{t("details")}</h2>
        <dl className="text-sm border-t border-border">
          <div className="flex justify-between gap-4 py-4 border-b border-border">
            <dt className="text-muted-foreground">{t("variety")}</dt>
            <dd className="text-right">{tea.variety}</dd>
          </div>
          <div className="flex justify-between gap-4 py-4 border-b border-border">
            <dt className="text-muted-foreground">{t("origin")}</dt>
            <dd className="text-right">{tea.origin}</dd>
          </div>
          <div className="flex justify-between gap-4 py-4 border-b border-border">
            <dt className="text-muted-foreground">{t("season")}</dt>
            <dd className="text-right">{tea.season}</dd>
          </div>
          <div className="flex justify-between gap-4 py-4 border-b border-border">
            <dt className="text-muted-foreground">{t("netWeight")}</dt>
            <dd className="text-right">{tea.netWeight}g</dd>
          </div>
        </dl>
      </section>

      {/* R1-A: 産地の地図。銘柄番号から座標が引けないときは自分で null を返す。
          詳細表の「産地」(Sanity の自由記述) の直後に置き、同じ話題を
          文字 → 図の順で読ませる。 */}
      <TeaOriginBlock
        menuNumber={tea.productNumber}
        heading={t("origin")}
        mapLabel={originMapLabel}
      />

      {/* 変A: 淹れ方ガイド (3ボックス横並び / SP 積上げ) */}
      {tea.brewingGuide && (
        <section className="mb-16 md:mb-24 max-w-3xl">
          <h2 className="text-sm font-medium mb-6">{t("brewingGuide")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="border border-border rounded-md p-5 flex items-baseline justify-between sm:flex-col sm:items-start sm:gap-2">
              <p className="text-xs text-muted-foreground">{t("temperature")}</p>
              <p className="text-lg font-medium">{tea.brewingGuide.temperature}</p>
            </div>
            <div className="border border-border rounded-md p-5 flex items-baseline justify-between sm:flex-col sm:items-start sm:gap-2">
              <p className="text-xs text-muted-foreground">{t("water")}</p>
              <p className="text-lg font-medium">{tea.brewingGuide.water}</p>
            </div>
            <div className="border border-border rounded-md p-5 flex items-baseline justify-between sm:flex-col sm:items-start sm:gap-2">
              <p className="text-xs text-muted-foreground">{t("time")}</p>
              <p className="text-lg font-medium">{tea.brewingGuide.time}</p>
            </div>
          </div>
        </section>
      )}

      {/* 変A: 購入する */}
      {tea.shopifyHandle && (
        <div className="mb-16 md:mb-24">
          <Link
            href={`/products/${tea.shopifyHandle}`}
            className="inline-block text-sm font-medium border border-foreground px-8 py-3 hover:bg-foreground hover:text-background transition-colors"
          >
            {t("buyNow")}
          </Link>
        </div>
      )}

      {/* 変A: 関連記事 (全幅行) */}
      {tea.relatedArticle && (
        <div className="max-w-3xl pt-8 border-t border-border">
          <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-3">
            {t("relatedArticle")}
          </p>
          <Link
            href={`/journal/${tea.relatedArticle.slug.current}`}
            className="group flex items-center justify-between gap-4 text-sm hover:text-muted-foreground transition-colors"
          >
            <span className="underline underline-offset-2">{tea.relatedArticle.title}</span>
            <span aria-hidden="true" className="text-muted-foreground group-hover:translate-x-1 transition-transform">→</span>
          </Link>
        </div>
      )}
    </div>
  );
}
