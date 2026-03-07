import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getClient } from "@/sanity/lib/client";
import { ARTICLE_BY_SLUG_QUERY } from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { PortableText } from "@/components/sanity/portable-text";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getLocale();

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
        <p className="text-muted">記事を読み込めませんでした。</p>
      </div>
    );
  }

  if (!article) notFound();

  return (
    <article className="max-w-3xl mx-auto px-6 py-16">
      {/* Header */}
      <header className="mb-12">
        {article.category && (
          <p className="text-[12px] text-light uppercase tracking-wider mb-4">
            {article.category.title}
          </p>
        )}
        <h1 className="mb-4">{article.title}</h1>
        {article.excerpt && (
          <p className="text-muted text-[14px] leading-relaxed">{article.excerpt}</p>
        )}
        <div className="flex items-center gap-4 mt-6 text-[12px] text-light">
          {article.author && <span>{article.author.name}</span>}
          {article.publishedAt && (
            <time>{new Date(article.publishedAt).toLocaleDateString("ja-JP")}</time>
          )}
          {article.memberOnly && (
            <span className="text-muted">[会員限定]</span>
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
            className="w-full"
            priority
          />
        </div>
      )}

      {/* Body */}
      {article.body && (
        <div className="prose-custom">
          <PortableText value={article.body} />
        </div>
      )}
    </article>
  );
}
