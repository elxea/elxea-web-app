import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { AUTHOR_BY_SLUG_QUERY, ARTICLES_BY_AUTHOR_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { ArticleCard } from "@/components/journal/article-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const client = getClient();
    const author = await client.fetch(AUTHOR_BY_SLUG_QUERY, { slug });
    if (!author) return {};
    const image = author.image?.asset ? urlFor(author.image).width(400).url() : undefined;
    return {
      title: author.name,
      description: author.bio?.slice(0, 160) || author.name,
      openGraph: {
        title: author.name,
        images: image ? [{ url: image }] : [],
      },
    };
  } catch {
    return {};
  }
}

export default async function PeoplePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();
  const t = await getTranslations("people");
  const tCommon = await getTranslations("common");

  let author;
  let articles: unknown[] = [];
  try {
    const client = getClient();
    author = await client.fetch(AUTHOR_BY_SLUG_QUERY, { slug });
    if (author) {
      articles = await client.fetch(ARTICLES_BY_AUTHOR_QUERY, {
        language: locale,
        authorSlug: slug,
      });
    }
  } catch {
    return (
      <div className="section-narrow">
        <p className="text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!author) notFound();

  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      {/* Profile */}
      <div className="flex flex-col sm:flex-row items-start gap-8 mb-16">
        {author.image?.asset && (
          <Image
            src={urlFor(author.image).width(200).height(200).url()}
            alt={author.name}
            width={200}
            height={200}
            className="size-24 sm:size-32 rounded-full object-cover flex-shrink-0"
            priority
          />
        )}
        <div>
          <h1 className="mb-2">{author.name}</h1>
          {author.role && (
            <p className="text-sm text-muted-foreground mb-4">{author.role}</p>
          )}
          {author.bio && (
            <p className="text-sm text-muted-foreground leading-relaxed">{author.bio}</p>
          )}
          {author.website && (
            <a
              href={author.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              {author.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
      </div>

      {/* Articles by this author */}
      {articles && articles.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-8">{t("articlesByAuthor")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {(articles as Parameters<typeof ArticleCard>[0]["article"][]).map(
              (article) => (
                <ArticleCard
                  key={article._id}
                  article={article}
                  locale={locale}
                  memberOnlyLabel={tCommon("memberOnly")}
                />
              )
            )}
          </div>
        </section>
      )}
    </div>
  );
}
