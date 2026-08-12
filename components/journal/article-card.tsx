import { Link } from "@/i18n/navigation";
import { urlFor } from "@/sanity/lib/image";
import { ImageCard } from "@/components/media/image-card";
import { previewSeedEnabled, previewImageForKey } from "@/lib/preview-seed";

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
  // Preview-only: articles without imagery fall back to a stable local
  // placeholder photo so cards render at layout density. No effect when unset.
  const resolvedImage = image?.asset
    ? urlFor(image).width(600).height(400).url()
    : previewSeedEnabled()
      ? previewImageForKey(article._id)
      : undefined;

  return (
    <div className="group">
      <Link
        href={`/journal/${article.slug.current}`}
        className="block"
      >
        <ImageCard
          image={resolvedImage}
          alt={image?.alt || article.title}
          className="mb-4"
          hover
        />
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
