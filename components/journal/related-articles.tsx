import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { urlFor } from "@/sanity/lib/image";

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
  locale: string;
};

export function RelatedArticles({ articles, heading, locale }: RelatedArticlesProps) {
  if (!articles || articles.length === 0) return null;

  return (
    <section className="border-t border-border pt-12 mt-16">
      <h2 className="text-lg font-medium mb-8">{heading}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-8">
        {articles.map((article) => {
          const image = article.thumbnail ?? article.mainImage;
          return (
            <Link
              key={article._id}
              href={`/journal/${article.slug.current}`}
              className="group block"
            >
              <div className="aspect-[3/2] bg-muted mb-3 overflow-hidden rounded-md">
                {image?.asset ? (
                  <Image
                    src={urlFor(image).width(400).height(267).url()}
                    alt={image.alt || article.title}
                    width={400}
                    height={267}
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                    {article.title}
                  </div>
                )}
              </div>
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
                    {new Date(article.publishedAt).toLocaleDateString(locale)}
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
