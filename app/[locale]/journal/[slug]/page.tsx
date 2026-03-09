import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { ARTICLE_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";
import { isAuthenticated } from "@/lib/shopify/auth";
import { MemberGate } from "@/components/ui/member-gate";

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
    const image = article.mainImage?.asset ? urlFor(article.mainImage).width(1200).url() : undefined;
    return {
      title: article.title,
      description: article.excerpt?.slice(0, 160),
      openGraph: {
        title: article.title,
        description: article.excerpt?.slice(0, 160),
        images: image ? [{ url: image }] : [],
      },
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

  let article;
  try {
    const client = getClient();
    article = await client.fetch(ARTICLE_BY_SLUG_QUERY, {
      slug,
      language: locale,
    });
  } catch {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!article) notFound();

  // Member-only content gating
  const isMemberOnly = article.memberOnly === true;
  const loggedIn = isMemberOnly ? await isAuthenticated() : true;

  const imageUrl = article.mainImage?.asset
    ? urlFor(article.mainImage).width(1200).url()
    : undefined;

  return (
    <article className="max-w-3xl mx-auto px-6 py-16">
      {/* Header */}
      <header className="mb-12">
        {article.category && (
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-4">
            {article.category.title}
          </p>
        )}
        <h1 className="mb-4">{article.title}</h1>
        {article.excerpt && (
          <p className="text-muted-foreground text-sm leading-relaxed">{article.excerpt}</p>
        )}
        <div className="flex items-center gap-4 mt-6 text-xs text-muted-foreground">
          {article.author && <span>{article.author.name}</span>}
          {article.publishedAt && (
            <time>{new Date(article.publishedAt).toLocaleDateString(locale)}</time>
          )}
          {isMemberOnly && (
            <span className="text-muted-foreground">[{tCommon("memberOnly")}]</span>
          )}
        </div>
      </header>

      {/* Main image */}
      {article.mainImage?.asset && (
        <div className="mb-12">
          <Image
            src={urlFor(article.mainImage).width(1200).url()}
            alt={article.mainImage.alt || article.title}
            width={1200}
            height={675}
            sizes="(max-width: 768px) 100vw, 768px"
            className="w-full"
            priority
          />
        </div>
      )}

      {/* Body — gated for member-only content */}
      {loggedIn ? (
        article.body && (
          <div className="prose-custom">
            <PortableText value={article.body} />
          </div>
        )
      ) : (
        <MemberGate />
      )}
    </article>
  );
}
