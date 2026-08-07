import * as React from "react";

import { Link } from "@/i18n/navigation";
import { ImageCard } from "@/components/ui/image-card";
import {
  bodySmClass,
  captionClass,
  overlineClass,
} from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * Journal list primitives (C4 基盤).
 *
 * Figma が正本 — 【R2: 確定版】ジャーナル一覧
 * (PC 8073:44722 / SP 8074:4044)。商品一覧・お茶メニューと同じ
 * PageHead / Toolbar / MoreRow を `components/catalog/*` から借り、
 * ジャーナル固有の 3 部品 (特集枠・2 列グリッド・サイドバー) だけをここに置く。
 *
 * Figma 実測 (px) → 実装の対応:
 * - ブロック間の縦間隔  PC 48 / SP 32               → `mt-8 lg:mt-12`
 * - HeroFeature 内 gap  16 (label→写真→メタ→見出し→リード) → `gap-4`
 *   写真          PC 1312x546 (2.403:1) / SP 343x229 (1.498:1 ≒ 3/2)
 *   リード        PC は x216 w880 の中央寄せ / SP は全幅左寄せ
 * - Main          PC = ArticleList 936 + gap 32 + ArticleRail 344 = 1312
 * - ArticleList   PC 2 列 452 / gap-x 32 / gap-y 64
 *                 SP 2 列 163.5 / gap-x 16 / gap-y 32
 * - ArticleRail   幅 344 / 内側 padding-x 16 / 行は tap 44px
 *                 SP は MoreRow の下へ積み上げ、人気の記事 3 件のみ
 *
 * 値の出どころ: 文字組みは `typography.style.*` トークン (rule-list の再輸出)。
 * 色は semantic token。寸法は Tailwind spacing scale (= spacing.* トークンと
 * 同じ 0.25rem 刻み。344px = `w-86` / 880px = `max-w-220`)。生 px・生カラーは
 * 書かない。
 */

/* -------------------------------------------------------------------------- */
/* HeroFeature — 特集枠 (Figma 8073:44991 / 8074:4053)                          */
/* -------------------------------------------------------------------------- */

export type HeroFeatureProps = {
  href: string;
  /** 「特集」ラベル。 */
  label: string;
  image?: string;
  imageAlt?: string;
  /** 写真下の 1 行 (カテゴリ — 日付)。 */
  meta?: React.ReactNode;
  title: string;
  lead?: string;
  className?: string;
};

export function HeroFeature({
  href,
  label,
  image,
  imageAlt,
  meta,
  title,
  lead,
  className,
}: HeroFeatureProps) {
  return (
    <section
      data-slot="hero-feature"
      className={cn("group flex flex-col gap-4", className)}
    >
      <p className={cn(overlineClass, "text-muted-foreground")}>{label}</p>
      <Link href={href} className="block">
        {/* 写真のアスペクトは SP 3/2 → PC 1312:546。ImageCard は
            `aspectRatio` をインライン style で当てるため、CSS 変数を
            レスポンシブに差し替えて渡す (インライン style が常に勝つので、
            クラス側の aspect-* では上書きできない)。 */}
        <ImageCard
          className="[--hero-ar:3/2] lg:[--hero-ar:1312/546]"
          style={{ aspectRatio: "var(--hero-ar)" }}
          image={image}
          alt={imageAlt ?? title}
          width={1312}
          height={546}
          sizes="(max-width: 1024px) 100vw, 1312px"
          priority
          hover
        />
      </Link>
      {meta ? (
        <p className={cn(captionClass, "text-muted-foreground")}>{meta}</p>
      ) : null}
      <h2
        data-slot="hero-feature-title"
        className="text-foreground underline-offset-4 group-hover:underline"
      >
        <Link href={href}>{title}</Link>
      </h2>
      {lead ? (
        <p
          className={cn(
            bodySmClass,
            "text-muted-foreground lg:mx-auto lg:max-w-220 lg:text-center"
          )}
        >
          {lead}
        </p>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* JournalLayout — PC: 記事グリッド + サイドバー / SP: 縦積み                    */
/* -------------------------------------------------------------------------- */

/**
 * Figma の PC は `記事グリッド 936 + サイドバー 344`、MoreRow は 1312 幅の中央。
 * SP は グリッド → MoreRow → サイドバー の順に積む。SP は flex + `order`、
 * PC は grid の行列指定で並べ替える (DOM 順は 1 つで済ませる)。
 */
export function JournalLayout({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="journal-layout"
      className={cn(
        "flex flex-col",
        "lg:grid lg:grid-cols-[minmax(0,1fr)_21.5rem] lg:gap-x-8",
        className
      )}
      {...props}
    />
  );
}

export function JournalGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="journal-grid"
      className={cn(
        "order-1 grid grid-cols-2 gap-x-4 gap-y-8 lg:col-start-1 lg:row-start-1 lg:gap-x-8 lg:gap-y-16",
        className
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* ArticleRail — Journal 内回遊のみ (Figma 8073:45005 / 8074:4060)              */
/* -------------------------------------------------------------------------- */

export type RailLink = { label: string; href: string };

export type ArticleRailProps = {
  popularTitle: string;
  popular: RailLink[];
  categoryTitle: string;
  categories: RailLink[];
  className?: string;
};

/**
 * サイドバー。商品導線は置かない (Figma の注記「Journal 内回遊のみ — 商品導線
 * なし」)。SP は Figma に合わせて人気の記事 3 件まで、カテゴリ節は出さない
 * (SP はツールバーのチップが同じ役割を担うため)。
 */
export function ArticleRail({
  popularTitle,
  popular,
  categoryTitle,
  categories,
  className,
}: ArticleRailProps) {
  if (popular.length === 0 && categories.length === 0) return null;

  return (
    <aside
      data-slot="article-rail"
      className={cn(
        "order-3 mt-8 px-4 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:w-86",
        className
      )}
    >
      {popular.length > 0 ? (
        <>
          <p className={cn(captionClass, "text-muted-foreground")}>{popularTitle}</p>
          <ul className="mt-2">
            {popular.map((item, index) => (
              <li
                key={item.href}
                className={index >= 3 ? "hidden lg:block" : undefined}
              >
                <RailRowLink {...item} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {categories.length > 0 ? (
        <div className="mt-6 hidden lg:block">
          <p className={cn(captionClass, "text-muted-foreground")}>{categoryTitle}</p>
          <ul className="mt-2">
            {categories.map((item) => (
              <li key={item.href}>
                <RailRowLink {...item} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

/** Figma の rail 行は高さ 44 (タップ域)。 */
function RailRowLink({ label, href }: RailLink) {
  return (
    <Link
      href={href}
      className={cn(
        bodySmClass,
        "flex h-11 items-center text-foreground underline-offset-4 hover:underline"
      )}
    >
      {label}
    </Link>
  );
}
