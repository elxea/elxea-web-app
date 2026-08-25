import * as React from "react";

import { Link } from "@/i18n/navigation";
import { ImageCard } from "@/components/media/image-card";
import {
  bodyClass,
  bodySmClass,
  captionClass,
  overlineClass,
} from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * トップページ R2 の節骨格 (C8-1 基盤).
 *
 * Figma が正本 — 【R2: 確定版】トップ (必須5本 + 追加4 / 導線ブロック最下部)
 * PC `8109:46558` / SP `8109:46620` (file AWLnI0XF07e8rScuxPYPc7)。
 * 採用バナー `8114:23`「決定 2026/08/08 見た目一括承認 (Setaka)・凍結」。
 *
 * 既存の R2 部品で足りるものはここに作らず再利用する:
 * - 定期便スペック行 (8110:2529) …… `SpecBand` (components/editorial/section-blocks.tsx)
 * - VOICES 味の記憶3カラム (8110:2546) …… `TripleColumn` (同上)
 * - 茶 (EC) の商品カード (8109:46601) …… `ProductCard` → `CatalogCard` → `ImageCard`
 *
 * Figma 実測 (px) → 実装の対応:
 * - 節の上下余白        PC 96 / SP 24            → `py-6 lg:py-24`
 * - 外余白 / 内容幅     PC 64 / 1312・SP 16 / 343 → `.page-container`
 * - 節見出し            overline 17 + gap 12 + title 38 (= jp/h1 32 x 1.2)
 * - 一報リスト行        PC pitch 52 (title 28 + 24) / SP pitch 44 (title 28 + 16)
 * - カテゴリタイル      IMG 416x300 + gap 12 + label 25、PC 3列 gap-x32 gap-y48
 * - 章切り (暗転)       bg = primary #464748 / title = primary-foreground / 補助 = sand
 * - 見出しの色           `globals.css` の `@layer base` が h1-h6 に brand-graphite
 *                        (#464748 = Figma `foreground`) を当てる。utility で
 *                        `text-foreground` を重ねると charcoal (#5d5e61) になり
 *                        Figma と外れるので、見出しには色 utility を当てない。
 * - 導線ブロック        bg = sand #d5d3c0、4列 304 gap32、tile は上罫線 1 本
 *
 * 値の出どころ: 文字組みは `typography.style.*` トークン (rule-list から再輸出された
 * CSS 変数)。色は semantic / brand トークン。寸法は Tailwind spacing scale
 * (= spacing.* トークンと同じ 0.25rem 刻み)。生 px・生カラーはこのファイルに書かない。
 */

/* -------------------------------------------------------------------------- */
/* TopSection — 内容幅 + 節の上下余白 (PC 96 / SP 24)                           */
/* -------------------------------------------------------------------------- */

export function TopSection({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="top-section"
      className={cn("page-container py-6 lg:py-24", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* TopSectionHead — 英字キッカー + 32px 見出し (Figma 8109:46597 / 8109:46569)  */
/* -------------------------------------------------------------------------- */

export type TopSectionHeadProps = {
  /** 英字キッカー (Figma "TEA LEAVES" / "CATEGORIES" / "SEASONAL")。 */
  overline: string;
  /** 日本語見出し。一報リストの節 (SEASONAL / JOURNAL / EVENT) は持たない。 */
  title?: string;
  /** 見出し下のリード 1 行 (導線ブロックのみ)。 */
  lead?: string;
  /**
   * SP ではキッカーを描かない。Figma SP 茶 (EC) `8109:46644` は head が
   * 見出し「茶葉」1 本だけで、PC `8109:46597` の "TEA LEAVES" を持たない。
   * 装飾の英字なので SP では DOM ごと落とす (a11y ツリーからも消える)。
   */
  overlineSpHidden?: boolean;
  /**
   * SP では 32px 見出しを描かない。Figma SP カテゴリ `8109:46629` は head が
   * キッカー "CATEGORIES" だけで、PC `8109:46569` の見出しを持たない。
   * 節の名前づけを失わないよう、見出しは `sr-only` で a11y ツリー / SEO に残す。
   */
  titleSpHidden?: boolean;
  className?: string;
};

export function TopSectionHead({
  overline,
  title,
  lead,
  overlineSpHidden,
  titleSpHidden,
  className,
}: TopSectionHeadProps) {
  return (
    <div data-slot="top-section-head" className={cn("flex flex-col", className)}>
      <p
        className={cn(
          overlineClass,
          "text-muted-foreground",
          overlineSpHidden && "hidden lg:block"
        )}
      >
        {overline}
      </p>
      {title ? (
        /* 体裁は h1 プリセット (32px)。Figma の節見出しは jp/h1 = 32 / lh 1.2 で
           ページ主見出し (44px display) の 1 段下。globals.css の unlayered な
           `h2 { font: … }` が utilities に勝つため、体裁は同ファイルの
           `h2[data-slot="top-section-title"]` 規則で当てる (section-title と同型)。 */
        <h2
          data-slot="top-section-title"
          className={cn(
            /* キッカーを SP で落とす節では見出しが head の先頭に来るので、
               キッカーとの間隔 12 も SP では持たせない。
               見出しを SP で落とす節では h2 の高さが 0 になるので同じく 0。 */
            overlineSpHidden || titleSpHidden ? "mt-0 lg:mt-3" : "mt-3"
          )}
        >
          {/* 可視化の切替は内側の span に持たせる。Tailwind の `not-sr-only` は
              `margin: 0` を含むので h2 に直接当てると PC の間隔 12 が消える。 */}
          {titleSpHidden ? (
            <span className="sr-only lg:not-sr-only">{title}</span>
          ) : (
            title
          )}
        </h2>
      ) : null}
      {lead ? (
        <p className={cn(bodyClass, "mt-4 text-muted-foreground lg:mt-6")}>{lead}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FeedList — 一報リスト (Figma 8110:2503 / 8109:46605 / 8110:2516)             */
/* 行 = タイトル (body 16) + メタ (caption 12)。罫線なし・左詰め。               */
/* -------------------------------------------------------------------------- */

export type FeedItem = {
  /** 一覧・詳細への遷移先。実在ルートのみを渡す。 */
  href: string;
  title: string;
  /** 日付 / 開催形式など 1 行の補足。 */
  meta?: React.ReactNode;
};

export function FeedList({
  items,
  className,
}: {
  items: readonly FeedItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <ul
      data-slot="feed-list"
      /* SP の行ピッチは Figma 実測 44 (8110:47189 の行 y42/86/130・各 h44)。
         行枠そのものが 44 (= タップ域) なので SP では行間 gap を持たせない。
         min-h 44 + gap 16 を積むとピッチ 60 になり Figma から外れる。
         PC は行高 28 + gap 24 = ピッチ 52 (8110:2505/2508/2511)。 */
      className={cn("mt-4 flex flex-col gap-0 lg:mt-6 lg:gap-6", className)}
    >
      {items.map((item) => (
        <li key={item.href + item.title}>
          <Link
            href={item.href}
            /* SP の行枠は Figma 実測 44 = タップ域。1 行を枠の中で上下中央に置く
               (Figma SP も h44 の枠に 1 行だけを収めている)。PC は行高 28 のまま
               タイトルとメタをベースラインで揃える。 */
            className="group flex min-h-11 flex-wrap items-center gap-x-8 gap-y-1 lg:min-h-0 lg:items-baseline"
          >
            <span
              className={cn(
                bodyClass,
                "text-foreground underline-offset-4 group-hover:underline"
              )}
            >
              {item.title}
            </span>
            {item.meta ? (
              /* Figma SP の行 (8110:47189) はタイトル 1 行だけで日付を持たない。
                 SP で 2 行目に回すと行高が 44 を超えるので視覚上は落とすが、
                 情報を失わないよう `sr-only` で a11y ツリー / クローラには残す。
                 PC (8110:2507 等) はタイトル右に 32 の間隔で並べる。 */
              <span
                className={cn(
                  captionClass,
                  "sr-only text-muted-foreground lg:not-sr-only"
                )}
              >
                {item.meta}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* ActionTileGrid / ActionTile — 「茶を探す」タイル (Figma 8109:46572)          */
/* PC 3列 416 gap-x32 gap-y48 / SP 1列 343 gap-y24。写真 + ラベルのみ。          */
/* -------------------------------------------------------------------------- */

export function ActionTileGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-tile-grid"
      className={cn(
        "mt-6 grid grid-cols-1 gap-x-8 gap-y-6 lg:mt-12 lg:grid-cols-3 lg:gap-y-12",
        className
      )}
      {...props}
    />
  );
}

export function ActionTile({
  href,
  image,
  imageAlt,
  label,
  className,
}: {
  href: string;
  image?: string;
  imageAlt?: string;
  label: string;
  className?: string;
}) {
  /* 写真が無いときは写真枠を確保しない (#9)。
   *
   * ImageCard は写真が無くても 416x300 の枠 (SP 343x247) を敷いてグレーの
   * プレースホルダを描く。カテゴリ 6 件のうち写真があるのは 2 件だけなので、
   * SP では節の高さ約 1,075px の大半が「何も無い灰色」になっていた
   * (実測 2026-08-25 / img 2 件・リンク 6 件)。
   *
   * 行き先は消さない — 消すとカテゴリへの入口そのものが無くなる。写真の代わりに
   * 高さ 44 (タップ域) の 1 行に畳んで、枠だけを詰める。写真が入稿されれば
   * 自動で元の写真タイルに戻る (この分岐は入稿状態を見ているだけ)。 */
  if (!image) {
    return (
      <Link
        href={href}
        data-slot="action-tile"
        data-variant="compact"
        className={cn(
          "group flex min-h-11 items-center border-b border-border",
          className
        )}
      >
        <span
          className={cn(
            bodySmClass,
            "text-foreground underline-offset-4 group-hover:underline"
          )}
        >
          {label}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      data-slot="action-tile"
      className={cn("group flex flex-col gap-3", className)}
    >
      {/* Figma の写真枠は PC 416x300 / SP 343x247 = ほぼ同一比。ImageCard の
          aspectRatio に Figma の実寸比をそのまま渡す (生 px は使わない)。 */}
      <ImageCard
        image={image}
        alt={imageAlt ?? label}
        aspectRatio="416/300"
        width={416}
        height={300}
        sizes="(max-width: 1024px) 100vw, 416px"
        hover
      />
      <span
        className={cn(
          bodySmClass,
          "text-foreground underline-offset-4 group-hover:underline"
        )}
      >
        {label}
      </span>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* QuietLinkRow — 中央 1 本の静かな導線 (Figma 8109:46617 / 8110:2514)          */
/* -------------------------------------------------------------------------- */

export function QuietLinkRow({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <div data-slot="quiet-link-row" className={cn("flex justify-center", className)}>
      <Link
        href={href}
        className={cn(
          bodyClass,
          "inline-flex min-h-11 items-center text-foreground underline-offset-4 hover:underline"
        )}
      >
        {label}
      </Link>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ChapterStatement — 明度反転の章切り (Figma 8109:46592 / 8109:46640)          */
/* bg = primary #464748 / 見出し = primary-foreground / 補助 = brand sand。     */
/* -------------------------------------------------------------------------- */

export function ChapterStatement({
  overline,
  title,
  body,
  className,
}: {
  overline: string;
  title: string;
  body?: string;
  className?: string;
}) {
  return (
    <section
      data-slot="chapter-statement"
      /* 全幅の帯。Figma の上下余白は PC 163.5 / SP 126 → spacing scale の
         160 / 128 に丸める (Δ3.5 / Δ2 は忠実度対比表に記録)。 */
      className={cn("bg-primary py-32 lg:py-40", className)}
    >
      <div className="page-container">
        {/* 本文の折返し幅は Figma 実測 480 = 30rem。 */}
        <div className="mx-auto flex max-w-120 flex-col items-center text-center">
          <p className={cn(overlineClass, "text-brand-sand")}>{overline}</p>
          <h2
            data-slot="top-section-title"
            /* キッカー→見出しは Figma 実測 24 (PC 8109:46593 y163.5 h17 →
               8109:46594 y204.5 / SP 8109:46641 y126 h17 → 8109:46642 y167)。 */
            className="mt-6 text-primary-foreground"
          >
            {title}
          </h2>
          {body ? (
            <p className={cn(bodySmClass, "mt-6 text-brand-sand")}>{body}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* ServiceGuideBlock — 導線ブロック (Figma 8109:46616 / instance)               */
/* bg = brand sand。head → 4 タイル → 罫線 + About 行。最下部に置く。            */
/* -------------------------------------------------------------------------- */

export type ServiceGuideTile = {
  /** 英字キッカー (Figma "TEA" / "JOURNAL" / "EVENT" / "ROJI")。 */
  overline: string;
  title: string;
  body: string;
  href: string;
  linkLabel: string;
};

export type ServiceGuideAbout = {
  title: string;
  body: string;
  href: string;
  linkLabel: string;
};

export function ServiceGuideBlock({
  overline,
  title,
  lead,
  tiles,
  about,
  className,
}: {
  overline: string;
  title: string;
  lead: string;
  tiles: readonly ServiceGuideTile[];
  about: ServiceGuideAbout;
  className?: string;
}) {
  return (
    <section
      data-slot="service-guide-block"
      className={cn("bg-brand-sand", className)}
    >
      <div className="page-container py-8 lg:py-24">
        <TopSectionHead overline={overline} title={title} lead={lead} />

        {/* Figma PC は 4 列 304 / gap 32、head からの間隔 64。 */}
        <div className="mt-8 grid grid-cols-1 gap-8 lg:mt-16 lg:grid-cols-4">
          {tiles.map((tile) => (
            <div
              key={tile.href + tile.overline}
              data-slot="service-guide-tile"
              className="flex flex-col border-t border-border pt-6"
            >
              <p className={cn(overlineClass, "text-muted-foreground")}>
                {tile.overline}
              </p>
              {/* Figma のタイル見出しは 24px = h2 トークン。 */}
              <h3 data-slot="service-guide-tile-title" className="mt-3">
                {tile.title}
              </h3>
              <p className={cn(bodySmClass, "mt-3 text-muted-foreground")}>
                {tile.body}
              </p>
              <Link
                href={tile.href}
                className={cn(
                  bodySmClass,
                  "mt-3 inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
                )}
              >
                {tile.linkLabel}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-border pt-6 lg:mt-16">
          <p className={cn(bodyClass, "text-foreground")}>{about.title}</p>
          <p className={cn(bodySmClass, "text-muted-foreground")}>{about.body}</p>
          <Link
            href={about.href}
            className={cn(
              bodySmClass,
              "inline-flex min-h-11 items-center text-foreground underline underline-offset-4 lg:ml-auto"
            )}
          >
            {about.linkLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* TopHero — 非対称 2 カラムのヒーロー (Figma 8109:46560 / 8109:46622-46627)    */
/* PC: 左 text 416 + gutter 32 + 右 IMG 864x560 / SP: IMG 375x300 → text。      */
/* -------------------------------------------------------------------------- */

export function TopHero({
  title,
  subtitle,
  lead,
  ctaHref,
  ctaLabel,
  image,
  className,
}: {
  /** 英字の主見出し。ページ主見出し = display トークン (44px)。 */
  title: string;
  subtitle: string;
  lead: string;
  ctaHref: string;
  ctaLabel: string;
  /** 写真枠 (PC は右カラム / SP は先頭で全幅)。1 つだけ描画して order で並べ替える。 */
  image: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-slot="top-hero"
      /* PC は 内容幅 1312 = text 416 + gutter 32 + IMG 864。416px は spacing
         スケール上の `w-104` (= 26rem) なので arbitrary value を使わない。
         SP は写真が上端に接する (Figma 8109:46622 は TopBar 直下 y=60) ので
         上余白は持たせない。 */
      className={cn(
        "page-container pb-8 lg:flex lg:items-start lg:gap-8 lg:py-24",
        className
      )}
    >
      {/* SP は写真が全幅。`.page-container` の外余白 (16 / md 32) を打ち消す。 */}
      <div className="-mx-4 md:-mx-8 lg:order-2 lg:mx-0 lg:min-w-0 lg:flex-1">
        {image}
      </div>

      {/* 内側 3 段の間隔は SP 16 / PC 24。SP は Figma 8109:46623 の子で実測
          (46624 h35 → 46625 y83 / 46625 h28 → 46626 y127 / 46626 h50 →
          46627 y193 = いずれも 16)。PC は 8109:46560 側が 24 で一致済み。 */}
      <div className="mt-8 flex flex-col lg:order-1 lg:mt-0 lg:w-104 lg:shrink-0">
        <h1 className="hero-display">{title}</h1>
        <p className={cn(bodyClass, "mt-4 text-foreground lg:mt-6")}>{subtitle}</p>
        <p className={cn(bodySmClass, "mt-4 text-muted-foreground lg:mt-6")}>{lead}</p>
        <div className="mt-4 lg:mt-6">
          <Link
            href={ctaHref}
            className={cn(
              bodySmClass,
              "inline-flex min-h-12 items-center rounded-full border border-border px-8 text-foreground",
              "transition-colors hover:bg-muted"
            )}
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
