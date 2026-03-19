import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { CATEGORIES_QUERY, ARTICLES_BY_CATEGORY_QUERY } from "@/sanity/lib/queries";
import { ArticleCard } from "@/components/journal/article-card";
import { Link } from "@/i18n/navigation";

type Category = {
  _id: string;
  title: string;
  slug: { current: string };
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const client = getClient();
    const categories: Category[] = await client.fetch(CATEGORIES_QUERY);
    const category = categories?.find((c) => c.slug.current === slug);
    if (!category) return {};
    return {
      title: category.title,
      description: `Articles in "${category.title}"`,
    };
  } catch {
    return {};
  }
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("journal");
  const tCommon = await getTranslations("common");

  const client = getClient();

  const [categories, articles] = await Promise.all([
    client.fetch(CATEGORIES_QUERY) as Promise<Category[]>,
    client.fetch(ARTICLES_BY_CATEGORY_QUERY, {
      language: locale,
      categorySlug: slug,
      start: 0,
      end: 30,
    }),
  ]);

  const category = categories?.find((c) => c.slug.current === slug);
  if (!category) notFound();

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <Link
        href="/journal"
        className="text-xs text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {t("title")}
      </Link>
      <h1 className="mt-2 mb-12">{category.title}</h1>

      {!articles || articles.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-12">
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
