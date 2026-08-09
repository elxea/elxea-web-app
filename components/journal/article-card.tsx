import { Link } from "@/i18n/navigation";
import { urlFor } from "@/sanity/lib/image";
import { ImageCard } from "@/components/ui/image-card";
import { bodySmClass, captionClass } from "@/components/editorial/rule-list";
import { formatArticleDate } from "@/lib/format-date";
import { previewSeedEnabled, previewImageForKey } from "@/lib/preview-seed";
import { cn } from "@/lib/utils";

/**
 * ArticleCard — Figma `ArticleCard — elxea/Journal S3` (実測 8073:45001)。
 *
 * Figma 実測 (PC 452 幅) → 実装:
 * - ImageCard      aspect 3/2 (コンポーネント名の宣言値)
 * - 写真 → info    gap 16                → `gap-4`
 * - info 内 gap    6 (カテゴリ/見出し/抜粋/メタの各行間) → `space-y-1.5`
 * - カテゴリ       行高 18 = caption 12px  → `captionClass`
 * - 見出し         行高 21 = body-sm 14px  → `bodySmClass` (体裁のみ・要素は h2)
 * - 抜粋           行高 21 / 2 行で省略    → `bodySmClass` + `line-clamp-2`
 * - メタ行         行高 18 / 著者・区切り・日付 → `captionClass`
 *                  日付は `YYYY.MM.DD` 固定 (`formatArticleDate`)。Figma の
 *                  「2026.08.05」表記に合わせるためロケール書式は使わない。
 *
 * 見出しの体裁は `globals.css` の `h2/h3[data-slot="article-card-title"]` で当てる
 * (同ファイルの unlayered な `h2 { font: … }` に Tailwind utilities が勝てない
 * ため。catalog-card-title と同じ理由)。
 *
 * ## 見出しレベルは呼び出し側が決める (`headingLevel`・既定 h2)
 *
 * カードが **節見出しを持つ帯の中**に入る画面では、カード見出しは節の下位なので
 * h3 にする (People 詳細 / 著者ページ の「この人の記事」)。カード帯が
 * **ページ直下の兄弟ブロック**である画面 (elxea Journal 一覧 / ジャーナル一覧 /
 * プレイリスト一覧) は節が無いので h2 のまま = h1 の直下で単調。
 * 根拠: Figma 8085:4299 では `HeroFeature` と `Main (グリッド + サイドバー)` が
 * どちらも `Content` 直下の**兄弟フレーム**で、グリッドを束ねる節フレームが無い。
 * 体裁は h2 / h3 のどちらでも同一 (globals.css の当該規則を参照)。
 */
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
  memberOnlyLabel: string;
  className?: string;
  /**
   * 詳細ページと絞り込みリンクの基点。既定は `/journal` なのでジャーナルは
   * 従来どおり。プレイリスト一覧 (Figma 8085:4327 も同じ ArticleCard を使う)
   * からは `/playlists` を渡して同じカードを共有する。
   */
  hrefBase?: string;
  /**
   * カード見出しの要素。既定は `h2` (カード帯がページ直下の兄弟ブロックの画面)。
   * 節見出しの下にカードが入る画面だけ `h3` を渡す。体裁は変わらない。
   */
  headingLevel?: "h2" | "h3";
};

export function ArticleCard({
  article,
  memberOnlyLabel,
  className,
  hrefBase = "/journal",
  headingLevel: Heading = "h2",
}: ArticleCardProps) {
  const image = article.thumbnail ?? article.mainImage;
  // Preview-only: articles without imagery fall back to a stable local
  // placeholder photo so cards render at layout density. No effect when unset.
  const resolvedImage = image?.asset
    ? urlFor(image).width(600).height(400).url()
    : previewSeedEnabled()
      ? previewImageForKey(article._id)
      : undefined;

  return (
    <div data-slot="article-card" className={cn("group flex flex-col gap-4", className)}>
      <Link href={`${hrefBase}/${article.slug.current}`} className="block">
        <ImageCard image={resolvedImage} alt={image?.alt || article.title} hover />
      </Link>
      <div className="space-y-1.5">
        {article.category && (
          <Link
            href={`${hrefBase}?category=${article.category.slug.current}`}
            className={cn(captionClass, "block text-muted-foreground hover:text-foreground")}
          >
            {article.category.title}
          </Link>
        )}
        <Link href={`${hrefBase}/${article.slug.current}`} className="block">
          <Heading
            data-slot="article-card-title"
            className={cn(bodySmClass, "text-foreground underline-offset-4 group-hover:underline")}
          >
            {article.memberOnly && (
              <span className="mr-1.5 text-muted-foreground">[{memberOnlyLabel}]</span>
            )}
            {article.title}
          </Heading>
        </Link>
        {article.excerpt && (
          <p className={cn(bodySmClass, "line-clamp-2 text-muted-foreground")}>
            {article.excerpt}
          </p>
        )}
        <div className={cn(captionClass, "flex items-center gap-2 text-muted-foreground")}>
          {article.author && <span>{article.author.name}</span>}
          {article.author && article.publishedAt && <span>&middot;</span>}
          {article.publishedAt && (
            <time dateTime={article.publishedAt}>
              {formatArticleDate(article.publishedAt)}
            </time>
          )}
        </div>
      </div>
    </div>
  );
}
