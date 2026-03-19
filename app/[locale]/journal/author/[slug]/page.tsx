import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import {
  AUTHOR_BY_SLUG_QUERY,
  ARTICLES_BY_AUTHOR_QUERY,
} from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
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
    const author = await client.fetch(AUTHOR_BY_SLUG_QUERY, { slug });
    if (!author) return {};
    return {
      title: author.name,
      description: author.bio ? author.bio.slice(0, 160) : `Articles by ${author.name}`,
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

  const client = getClient();

  const [author, articles] = await Promise.all([
    client.fetch(AUTHOR_BY_SLUG_QUERY, { slug }),
    client.fetch(ARTICLES_BY_AUTHOR_QUERY, {
      language: locale,
      authorSlug: slug,
      start: 0,
      end: 30,
    }),
  ]);

  if (!author) notFound();

  return (
    <div className="max-w-7xl mx-auto px-6 py-16">
      <Link
        href="/journal"
        className="text-xs text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {t("title")}
      </Link>

      {/* Author profile */}
      <div className="flex items-start gap-6 mt-6 mb-12">
        {author.image?.asset && (
          <Image
            src={urlFor(author.image).width(120).height(120).url()}
            alt={author.name}
            width={120}
            height={120}
            className="rounded-full size-20 object-cover flex-shrink-0"
          />
        )}
        <div className="space-y-1.5">
          <h1>{author.name}</h1>
          {author.role && (
            <p className="text-sm text-muted-foreground">{author.role}</p>
          )}
          {author.bio && (
            <p className="text-sm text-muted-foreground leading-relaxed mt-2">
              {author.bio}
            </p>
          )}
          {author.website && (
            <a
              href={author.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              {author.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
      </div>

      {/* Articles by this author */}
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
