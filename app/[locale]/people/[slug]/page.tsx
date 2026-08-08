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
    <div className="section-wide">
      {/* 変A: 中央寄せ profile (avatar上 / name / role / bio / website) — Figma 6703:14332 */}
      <div className="flex flex-col items-center text-center mb-16 md:mb-24">
        {author.image?.asset && (
          <Image
            src={urlFor(author.image).width(200).height(200).url()}
            alt={author.name}
            width={200}
            height={200}
            className="size-28 rounded-full object-cover mb-6"
            priority
          />
        )}
        <h1 className="mb-2">{author.name}</h1>
        {author.role && (
          <p className="text-sm text-muted-foreground mb-4">{author.role}</p>
        )}
        {author.bio && (
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{author.bio}</p>
        )}
        {author.website && (
          <a
            href={author.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors mt-4"
          >
            {author.website.replace(/^https?:\/\//, "")}
          </a>
        )}
      </div>

      {/* Articles by this author */}
      {articles && articles.length > 0 && (
        <section>
          {/* 変A: 中央寄せ editorial header */}
          <div className="text-center mb-12 md:mb-16">
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
              Articles
            </p>
            <h2 className="text-2xl font-normal">{t("articlesByAuthor")}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
            {(articles as Parameters<typeof ArticleCard>[0]["article"][]).map(
              (article) => (
                <ArticleCard
                  key={article._id}
                  article={article}
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
