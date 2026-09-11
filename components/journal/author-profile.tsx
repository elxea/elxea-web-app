import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { urlFor } from "@/sanity/lib/image";
import { PersonPlaceholder } from "@/components/media/person-placeholder";

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
  // C17-1: 著者ページ (/journal/author/[slug]) は People 詳細へ統合された
  // (Figma 7805:1952「【廃止: People 詳細へ統合】 ジャーナル:著者」)。
  // 旧 URL は next.config.ts の 308 で寄せてあるが、内部リンクは 1 ホップ
  // 無駄に踏ませないよう直接 /people/[slug] を指す。
  const authorLink = author.slug?.current
    ? `/people/${author.slug.current}`
    : null;

  return (
    <div className="border-t border-border pt-8 mt-12">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-4">
        {writtenByLabel}
      </p>
      <div className="flex items-start gap-4">
        {/* 写真が無いときは以前このスロットごと消えていた (`author.image?.asset &&`)。
            本番の著者は 5 名とも写真未設定なので、記事末尾のプロフィールが
            氏名だけ左端に寄った崩れた見た目になっていた。頭文字の面を出して
            レイアウトを保つ。Sanity には何も書かない (台帳では未設定のまま)。 */}
        {(() => {
          const avatar = author.image?.asset ? (
            <Image
              src={urlFor(author.image).width(80).height(80).url()}
              alt={author.name}
              width={80}
              height={80}
              className="rounded-full size-12 object-cover"
            />
          ) : (
            <PersonPlaceholder
              name={author.name}
              className="rounded-full size-12"
            />
          );
          return authorLink ? (
            <Link href={authorLink} className="flex-shrink-0">
              {avatar}
            </Link>
          ) : (
            <div className="flex-shrink-0">{avatar}</div>
          );
        })()}
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
