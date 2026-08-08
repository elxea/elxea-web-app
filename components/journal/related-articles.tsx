import { Link } from "@/i18n/navigation";
import { urlFor } from "@/sanity/lib/image";
import { ImageCard } from "@/components/ui/image-card";
import { formatArticleDate } from "@/lib/format-date";

type RelatedArticle = {
  _id: string;
  title: string;
  slug: { current: string };
  excerpt?: string;
  thumbnail?: { asset: object; alt?: string };
  mainImage?: { asset: object; alt?: string };
  publishedAt?: string;
  memberOnly?: boolean;
  category?: { title: string };
};

type RelatedArticlesProps = {
  articles: RelatedArticle[];
  heading: string;
};

export function RelatedArticles({ articles, heading }: RelatedArticlesProps) {
  if (!articles || articles.length === 0) return null;

  return (
    <section className="border-t border-border pt-12 mt-16">
      <h2 className="mb-8">{heading}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-10">
        {articles.map((article) => {
          const image = article.thumbnail ?? article.mainImage;
          return (
            <Link
              key={article._id}
              href={`/journal/${article.slug.current}`}
              className="group block"
            >
              <ImageCard
                image={image?.asset ? urlFor(image).width(400).height(267).url() : undefined}
                alt={image?.alt || article.title}
                className="mb-3"
                width={400}
                height={267}
                sizes="(max-width: 640px) 100vw, 50vw"
                hover
              />
              <div className="space-y-1">
                {article.category && (
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    {article.category.title}
                  </p>
                )}
                <h3 className="text-sm font-medium leading-snug group-hover:underline">
                  {article.title}
                </h3>
                {article.publishedAt && (
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={article.publishedAt}>
                      {formatArticleDate(article.publishedAt)}
                    </time>
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
