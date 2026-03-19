import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { urlFor } from "@/sanity/lib/image";

type AuthorProfileProps = {
  author: {
    name: string;
    slug?: { current: string };
    image?: { asset: object };
    role?: string;
    bio?: string;
    website?: string;
  };
  writtenByLabel: string;
};

export function AuthorProfile({ author, writtenByLabel }: AuthorProfileProps) {
  const authorLink = author.slug?.current
    ? `/journal/author/${author.slug.current}`
    : null;

  return (
    <div className="border-t border-border pt-8 mt-12">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-4">
        {writtenByLabel}
      </p>
      <div className="flex items-start gap-4">
        {author.image?.asset && (
          authorLink ? (
            <Link href={authorLink} className="flex-shrink-0">
              <Image
                src={urlFor(author.image).width(80).height(80).url()}
                alt={author.name}
                width={80}
                height={80}
                className="rounded-full size-12 object-cover"
              />
            </Link>
          ) : (
            <Image
              src={urlFor(author.image).width(80).height(80).url()}
              alt={author.name}
              width={80}
              height={80}
              className="rounded-full size-12 object-cover flex-shrink-0"
            />
          )
        )}
        <div className="space-y-1">
          {authorLink ? (
            <Link
              href={authorLink}
              className="text-sm font-medium hover:underline"
            >
              {author.name}
            </Link>
          ) : (
            <p className="text-sm font-medium">{author.name}</p>
          )}
          {author.role && (
            <p className="text-xs text-muted-foreground">{author.role}</p>
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
    </div>
  );
}
