import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { TAG_BY_SLUG_QUERY, ARTICLES_BY_TAG_QUERY } from "@/sanity/lib/queries";
import { ArticleCard } from "@/components/journal/article-card";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const client = getClient();
    const tag = await client.fetch(TAG_BY_SLUG_QUERY, { tagSlug: slug });
    if (!tag) return {};
    return {
      title: tag.title,
      description: `Articles tagged with "${tag.title}"`,
    };
  } catch {
    return {};
  }
}

export default async function TagPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("journal");
  const tCommon = await getTranslations("common");

  const client = getClient();

  const [tag, articles] = await Promise.all([
    client.fetch(TAG_BY_SLUG_QUERY, { tagSlug: slug }),
    client.fetch(ARTICLES_BY_TAG_QUERY, {
      language: locale,
      tagSlug: slug,
      start: 0,
      end: 30,
    }),
  ]);

  if (!tag) notFound();

  return (
    <div className="section-wide">
      <Link
        href="/journal"
        className="text-xs text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {t("title")}
      </Link>
      <h1 className="mt-2 mb-12">{tag.title}</h1>

      {!articles || articles.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
          {articles.map(
            (article: {
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
            }) => (
              <ArticleCard
                key={article._id}
                article={article}
                locale={locale}
                memberOnlyLabel={tCommon("memberOnly")}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
