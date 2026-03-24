import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { TEA_MENU_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { Link } from "@/i18n/navigation";
import { PortableText } from "@/components/sanity/portable-text";
import { ImageCard } from "@/components/ui/image-card";
import type { PortableTextBlock } from "@portabletext/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
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

  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        {/* Photo */}
        <ImageCard
          image={tea.photo?.asset ? urlFor(tea.photo).width(800).height(533).url() : undefined}
          alt={tea.photo?.alt || tea.displayName}
          width={800}
          height={533}
          sizes="(max-width: 1024px) 100vw, 50vw"
          style={tea.color ? { backgroundColor: tea.color } : undefined}
          priority
        />

        {/* Info */}
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
            {tea.category} · {tea.productNumber}
          </p>
          <h1 className="mb-4">{tea.displayName}</h1>

          {tea.description && (
            <div className="text-sm text-muted-foreground leading-relaxed mb-8">
              {typeof tea.description === "string" ? (
                <p>{tea.description}</p>
              ) : (
                <PortableText value={tea.description as PortableTextBlock[]} />
              )}
            </div>
          )}

          {/* Details table */}
          <dl className="space-y-3 text-sm border-t border-border pt-6">
            <div className="flex gap-4">
              <dt className="text-muted-foreground w-24 flex-shrink-0">{t("variety")}</dt>
              <dd>{tea.variety}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-muted-foreground w-24 flex-shrink-0">{t("origin")}</dt>
              <dd>{tea.origin}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-muted-foreground w-24 flex-shrink-0">{t("season")}</dt>
              <dd>{tea.season}</dd>
            </div>
            <div className="flex gap-4">
              <dt className="text-muted-foreground w-24 flex-shrink-0">{t("netWeight")}</dt>
              <dd>{tea.netWeight}g</dd>
            </div>
          </dl>

          {/* Brewing Guide */}
          {tea.brewingGuide && (
            <div className="mt-8 border border-border rounded-lg p-6">
              <h2 className="text-sm font-medium mb-4">{t("brewingGuide")}</h2>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-lg font-medium">{tea.brewingGuide.temperature}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("temperature")}</p>
                </div>
                <div>
                  <p className="text-lg font-medium">{tea.brewingGuide.water}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("water")}</p>
                </div>
                <div>
                  <p className="text-lg font-medium">{tea.brewingGuide.time}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("time")}</p>
                </div>
              </div>
            </div>
          )}

          {/* Shopify link */}
          {tea.shopifyHandle && (
            <div className="mt-8">
              <Link
                href={`/products/${tea.shopifyHandle}`}
                className="inline-block text-sm font-medium border border-foreground px-6 py-3 hover:bg-foreground hover:text-background transition-colors"
              >
                {t("buyNow")}
              </Link>
            </div>
          )}

          {/* Related article */}
          {tea.relatedArticle && (
            <div className="mt-8 pt-6 border-t border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                {t("relatedArticle")}
              </p>
              <Link
                href={`/journal/${tea.relatedArticle.slug.current}`}
                className="text-sm underline underline-offset-2 hover:text-muted-foreground transition-colors"
              >
                {tea.relatedArticle.title}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
