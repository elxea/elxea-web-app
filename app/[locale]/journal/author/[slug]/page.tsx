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

type AuthorDoc = {
  name: string;
  role?: string;
  bio?: string;
  website?: string;
  image?: { asset: object };
};

type AuthorArticle = {
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
};

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

  // A7: 以前はここが素の await で、Sanity 側の障害がそのまま 500 になっていた
  // (著者ページだけ他のジャーナル系ページと扱いが違った)。障害は 404 にも
  // 500 にもせず、他ページと同じ loadError 表示に倒す。
  let author: AuthorDoc | null;
  let articles: AuthorArticle[];
  try {
    [author, articles] = await Promise.all([
      client.fetch(AUTHOR_BY_SLUG_QUERY, { slug }),
      client.fetch(ARTICLES_BY_AUTHOR_QUERY, {
        language: locale,
        authorSlug: slug,
        start: 0,
        end: 30,
      }),
    ]);
  } catch {
    return (
      <div className="section-wide">
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  // 取得は成功したが著者が居ない = 本物の 404。
  if (!author) notFound();

  return (
    <div className="section-wide">
      {/* 変A: centered editorial author header */}
      <div className="flex flex-col items-center text-center mb-12 md:mb-16">
        {author.image?.asset && (
          <Image
            src={urlFor(author.image).width(160).height(160).url()}
            alt={author.name}
            width={160}
            height={160}
            className="rounded-full size-24 object-cover mb-6"
          />
        )}
        <p className="text-[11px] text-muted-foreground uppercase tracking-[0.25em] mb-4">
          Author
        </p>
        <h1 className="mb-2">{author.name}</h1>
        {author.role && (
          <p className="text-sm text-muted-foreground mb-2">{author.role}</p>
        )}
        {author.bio && (
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            {author.bio}
          </p>
        )}
        {author.website && (
          <a
            href={author.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors mt-3"
          >
            {author.website.replace(/^https?:\/\//, "")}
          </a>
        )}
      </div>

      {/* Articles by this author */}
      {!articles || articles.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-14">
          {articles.map((article) => (
            <ArticleCard
              key={article._id}
              article={article}
              locale={locale}
              memberOnlyLabel={tCommon("memberOnly")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
