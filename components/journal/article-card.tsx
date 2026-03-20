import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { urlFor } from "@/sanity/lib/image";

type ArticleCardProps = {
  article: {
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
  locale: string;
  memberOnlyLabel: string;
};

export function ArticleCard({ article, locale, memberOnlyLabel }: ArticleCardProps) {
  const image = article.thumbnail ?? article.mainImage;

  return (
    <div className="group">
      <Link
        href={`/journal/${article.slug.current}`}
        className="block"
      >
        <div className="aspect-[3/2] bg-muted mb-4 overflow-hidden rounded-md">
          {image?.asset ? (
            <Image
              src={urlFor(image).width(600).height(400).url()}
              alt={image.alt || article.title}
              width={600}
              height={400}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
              {article.title}
            </div>
          )}
        </div>
      </Link>
      <div className="space-y-1.5">
        {article.category && (
          <Link
            href={`/journal?category=${article.category.slug.current}`}
            className="text-xs text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          >
            {article.category.title}
          </Link>
        )}
        <Link
          href={`/journal/${article.slug.current}`}
          className="block"
        >
          <h2 className="text-sm font-medium leading-snug group-hover:underline">
            {article.memberOnly && (
              <span className="text-xs text-muted-foreground mr-1.5">[{memberOnlyLabel}]</span>
            )}
            {article.title}
          </h2>
        </Link>
        {article.excerpt && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {article.excerpt}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {article.author && <span>{article.author.name}</span>}
          {article.author && article.publishedAt && <span>&middot;</span>}
          {article.publishedAt && (
            <time>{new Date(article.publishedAt).toLocaleDateString(locale)}</time>
          )}
        </div>
      </div>
    </div>
  );
}
