import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { ARTICLE_BY_SLUG_QUERY, RELATED_ARTICLES_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";
import { isAuthenticated } from "@/lib/shopify/auth";
import { MemberGate } from "@/components/ui/member-gate";
import { AuthorProfile } from "@/components/journal/author-profile";
import { RelatedArticles } from "@/components/journal/related-articles";
import { Link } from "@/i18n/navigation";

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
      openGraph: {
        title,
        description,
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
      <div className="section-narrow">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!article) notFound();

  // Member-only content gating
  const isMemberOnly = article.memberOnly === true;
  const loggedIn = isMemberOnly ? await isAuthenticated() : true;

  // Fetch related articles (parallel with rendering setup)
  let relatedArticles: unknown[] = [];
  if (loggedIn && article.category?._id) {
    try {
      const client = getClient();
      relatedArticles = await client.fetch(RELATED_ARTICLES_QUERY, {
        language: locale,
        currentId: article._id,
        categoryId: article.category._id,
        tagIds: article.tags?.map((t: { _id: string }) => t._id) ?? [],
      });
    } catch {
      // silently fail — related articles are non-critical
    }
  }

  return (
    <article className="section-narrow">
      {/* Header */}
      <header className="mb-12">
        {article.category && (
          <Link
            href={`/journal/category/${article.category.slug.current}`}
            className="text-xs text-muted-foreground uppercase tracking-wider mb-4 block hover:text-foreground transition-colors"
          >
            {article.category.title}
          </Link>
        )}
        <h1 className="mb-4">{article.title}</h1>
        {article.excerpt && (
          <p className="text-muted-foreground text-sm leading-relaxed">{article.excerpt}</p>
        )}
        <div className="flex items-center gap-4 mt-6 text-xs text-muted-foreground">
          {article.author && (
            <Link
              href={`/journal/author/${article.author.slug?.current ?? ""}`}
              className="hover:text-foreground transition-colors"
            >
              {article.author.name}
            </Link>
          )}
          {article.publishedAt && (
            <time>{new Date(article.publishedAt).toLocaleDateString(locale)}</time>
          )}
          {isMemberOnly && (
            <span className="text-muted-foreground">[{tCommon("memberOnly")}]</span>
          )}
        </div>

        {/* Tags */}
        {article.tags && article.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {article.tags.map((tag: { _id: string; title: string; slug: { current: string } }) => (
              <Link
                key={tag._id}
                href={`/journal/tag/${tag.slug.current}`}
                className="text-xs text-muted-foreground border border-border px-2 py-0.5 rounded hover:text-foreground hover:border-foreground transition-colors"
              >
                {tag.title}
              </Link>
            ))}
          </div>
        )}
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
            className="w-full rounded-md"
            priority
          />
        </div>
      )}

      {/* Body — gated for member-only content */}
      {loggedIn ? (
        <>
          {article.body && (
            <div className="prose-custom">
              <PortableText value={article.body} />
            </div>
          )}

          {/* Audio/Video */}
          {article.audioVideoUrl && (
            <div className="mt-8 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                {t("media")}
              </p>
              <a
                href={article.audioVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline underline-offset-2 hover:text-muted-foreground transition-colors"
              >
                {article.audioVideoUrl}
              </a>
            </div>
          )}

          {/* Article-level CTA */}
          {article.cta?.title && (
            <div className="mt-12 border border-border rounded-lg overflow-hidden">
              {article.cta.image?.asset && (
                <Image
                  src={urlFor(article.cta.image).width(800).height(400).url()}
                  alt={article.cta.title}
                  width={800}
                  height={400}
                  sizes="(max-width: 768px) 100vw, 768px"
                  className="w-full object-cover rounded-md"
                />
              )}
              <div className="p-6">
                <p className="text-sm font-medium mb-3">{article.cta.title}</p>
                {article.cta.url && (
                  <a
                    href={article.cta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs font-medium border border-foreground px-4 py-2 hover:bg-foreground hover:text-background transition-colors"
                  >
                    {t("ctaButton")}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Author profile */}
          {article.author && (
            <AuthorProfile
              author={article.author}
              writtenByLabel={t("writtenBy")}
            />
          )}

          {/* Related articles */}
          <RelatedArticles
            articles={relatedArticles as Parameters<typeof RelatedArticles>[0]["articles"]}
            heading={t("relatedArticles")}
            locale={locale}
          />
        </>
      ) : (
        <MemberGate />
      )}
    </article>
  );
}
