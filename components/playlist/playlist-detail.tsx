import * as React from "react";

import { Link } from "@/i18n/navigation";
import {
  bodySmClass,
  captionClass,
  h4Class,
  overlineClass,
} from "@/components/editorial/rule-list";
import { ImageCard } from "@/components/ui/image-card";
import { cn } from "@/lib/utils";

/**
 * プレイリスト詳細の骨格部品 (C4-3).
 *
 * Figma が正本 — 【R2: 確定版】プレイリスト詳細
 * (PC 8089:4518 / SP 8089:4622)。People 詳細テンプレを踏襲した
 * 7 ブロック構成 (PlaylistHead / Quote / ARTISTS / TRACKS /
 * PLAYLIST DATA / 合わせるお茶 / OTHER PLAYLISTS) のうち、
 * 4カラム定義帯 (PLAYLIST DATA) は既存の `SpecBand` を使うため、
 * ここには残りの 5 種を置く。
 *
 * Figma 実測 (px) → 実装の対応:
 * - セクション上余白        PC 96 / SP 64            → `pt-16 lg:pt-24`
 * - セクション下余白        PC 48 前後 / SP 可変      → `pb-12`
 * - キッカー → 見出し       PC 8 / SP 8              → `mt-2`
 * - 見出し → 本体           PC 52 / SP 56            → `mt-14 lg:mt-13`
 * - 3カラム                 PC 416 gap32 / SP 縦積み  → `lg:grid-cols-3 lg:gap-x-8`
 * - 本文カラム              PC 640 / SP 343          → `max-w-160`
 *
 * 値の出どころ: 文字組みは `typography.style.*` トークン (rule-list からの
 * 再輸出)、色は semantic token、寸法は Tailwind spacing scale (= spacing.*
 * トークンと同じ 0.25rem 刻み)。生 px・生カラーは書かない。
 */

/* -------------------------------------------------------------------------- */
/* PlaylistSection / PlaylistSectionHead — 各節の共通枠                        */
/* -------------------------------------------------------------------------- */

export function PlaylistSection({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="playlist-section"
      className={cn("page-container pt-16 pb-12 lg:pt-24", className)}
      {...props}
    />
  );
}

/**
 * 節見出し。Figma はキッカー h17 (overline) → 8 → 見出し h27 (h3 プリセット)。
 * 体裁は `globals.css` の `h2[data-slot="section-title"]` 規則が当てる
 * (unlayered な `h2 { font: … }` に Tailwind utilities が勝てないため)。
 */
export function PlaylistSectionHead({
  overline,
  title,
  className,
}: {
  overline: React.ReactNode;
  title?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="playlist-section-head" className={className}>
      <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
      {title ? (
        <h2 data-slot="section-title" className="mt-2 text-foreground">
          {title}
        </h2>
      ) : null}
    </div>
  );
}

/** 見出しの下に置く本体ブロックの共通マージン (Figma PC 52 / SP 56)。 */
export function PlaylistSectionBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="playlist-section-body"
      className={cn("mt-14 lg:mt-13", className)}
      {...props}
    />
  );
}

/** 節末の注記 (Figma「近接比 note」「方針 note」「NP note」)。 */
export function PlaylistSectionNote({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="playlist-section-note"
      className={cn(captionClass, "mt-6 text-muted-foreground", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* PlaylistHead — アートワーク + 見出し (Figma 8089:4520 / 8089:4626)          */
/* -------------------------------------------------------------------------- */

export type PlaylistStat = { value: React.ReactNode; label: React.ReactNode };

export type PlaylistHeadProps = {
  /** 英字キッカー。 */
  overline: React.ReactNode;
  /** プレイリスト名 (ページ主見出し)。 */
  title: string;
  /** 見出し直下の 1 行 (シーン等)。 */
  subtitle?: React.ReactNode;
  /** 2 行程度の説明。 */
  lead?: React.ReactNode;
  image?: string;
  imageAlt?: string;
  /** 実数表示 (TRACKS / MIN)。空配列なら罫線ごと出さない。 */
  stats?: readonly PlaylistStat[];
  /** 選盤者クレジットの見出し (例「選盤」)。 */
  bylineLabel?: React.ReactNode;
  /** AuthorByline を差し込む。 */
  byline?: React.ReactNode;
  children?: React.ReactNode;
};

/**
 * Figma 実測 (PC 1440) → 実装:
 * - BreadcrumbRow      上余白 48 / 枠高 44 (タップ域)
 * - Photo              x64 640x800 (4:5)、Breadcrumb から 32
 * - HeroText           x736 640、写真上端から +96 のオフセット
 * - kicker → name      20 / name → subtitle 28 / subtitle → lead 20
 * - lead → 罫線        4 / 罫線 → Stats 24 (Figma 23)
 * - Stats → byline見出し 36 / byline見出し → byline 4 (Figma 5)
 * - SP は写真 → HeroText の縦積み (オフセットなし)
 */
export function PlaylistHead({
  overline,
  title,
  subtitle,
  lead,
  image,
  imageAlt,
  stats,
  bylineLabel,
  byline,
  children,
}: PlaylistHeadProps) {
  return (
    <section data-slot="playlist-head" className="page-container pt-12 pb-8">
      {children ? (
        <div className="flex min-h-11 items-center">{children}</div>
      ) : null}

      <div className="mt-8 lg:grid lg:grid-cols-2 lg:gap-x-8">
        <ImageCard
          className="lg:col-start-1"
          aspectRatio="4/5"
          image={image}
          alt={imageAlt ?? title}
          width={640}
          height={800}
          sizes="(max-width: 1024px) 100vw, 640px"
          priority
        />

        {/* Figma の HeroText は写真上端から +96 下げた位置に始まる。 */}
        <div
          data-slot="playlist-head-text"
          className="mt-14 lg:col-start-2 lg:mt-24"
        >
          <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
          <h1 className="page-title mt-5 text-foreground">{title}</h1>
          {subtitle ? (
            <p
              data-slot="playlist-head-subtitle"
              className="mt-7 text-muted-foreground"
            >
              {subtitle}
            </p>
          ) : null}
          {lead ? (
            <p className={cn(bodySmClass, "mt-5 text-muted-foreground")}>{lead}</p>
          ) : null}

          {stats && stats.length > 0 ? (
            <dl
              data-slot="playlist-stats"
              className="mt-1 flex gap-x-8 border-t border-border pt-6 lg:gap-x-12"
            >
              {stats.map((stat, i) => (
                <div key={i} className="flex items-baseline gap-3">
                  {/* Figma は 28px 相当。生 px を書かない規律により最も近い
                      h1 トークン (32px) に丸めた。 */}
                  <dd className="m-0 [font:var(--typography-style-h1)] text-foreground">
                    {stat.value}
                  </dd>
                  <dt className={cn(overlineClass, "text-muted-foreground")}>
                    {stat.label}
                  </dt>
                </div>
              ))}
            </dl>
          ) : null}

          {byline ? (
            <div className="mt-9">
              {bylineLabel ? (
                <p className={cn(captionClass, "text-muted-foreground")}>
                  {bylineLabel}
                </p>
              ) : null}
              <div className="mt-1">{byline}</div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* CuratorQuote — 反転面の引用 (Figma 8089:4541 / 8089:4646)                   */
/* -------------------------------------------------------------------------- */

/**
 * Figma 実測: 全幅の反転面。引用は 640 幅で中央、上余白 PC 88 / SP 64、
 * 引用 → 帰属 PC 56 / SP 52、下余白 PC 64 / SP 64。
 */
export function CuratorQuote({
  quote,
  attribution,
  className,
}: {
  quote: React.ReactNode;
  attribution?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-slot="curator-quote"
      className={cn("bg-foreground text-background", className)}
    >
      <div className="page-container pt-16 pb-16 text-center lg:pt-22">
        <blockquote data-slot="section-title" className="mx-auto max-w-160">
          {quote}
        </blockquote>
        {attribution ? (
          <p className={cn(captionClass, "mx-auto mt-13 max-w-160 opacity-70")}>
            {attribution}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* PhotoCardGrid — 写真つき 3 カラム (ARTISTS / 合わせるお茶 / OTHER)          */
/* -------------------------------------------------------------------------- */

export type PhotoCardItem = {
  key: string;
  image?: string;
  imageAlt?: string;
  /** リンクにするとき。無ければ非リンク (プレースホルダ・実データ無し)。 */
  href?: string;
  /** 通し番号など (ARTISTS の「no 01」)。 */
  overline?: React.ReactNode;
  title: React.ReactNode;
  /** 説明 / 産地メモ。 */
  note?: React.ReactNode;
  /** 価格・肩書などの補助行。 */
  meta?: React.ReactNode;
};

/**
 * Figma 実測:
 * - PC 3 列 416 / gap-x 32、SP 縦積み
 * - 写真 → 見出し 16、見出し → note 4、note → meta 2 (→ `mt-1` に丸め)
 * - ARTISTS の写真は PC 416x312 (4:3) / SP 3:2、他は 8:5 で共通
 * - SP の写真は Figma では全幅 375 (ページ余白外) だが、実装はページ
 *   カラム幅 (343) に収める【仕様】
 */
export function PhotoCardGrid({
  items,
  aspect = "8/5",
  aspectSp,
  className,
}: {
  items: readonly PhotoCardItem[];
  /** PC のアスペクト比。 */
  aspect?: string;
  /** SP で変えるとき。 */
  aspectSp?: string;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <ul
      data-slot="photo-card-grid"
      className={cn(
        "grid grid-cols-1 gap-10 lg:grid-cols-3 lg:gap-x-8",
        className
      )}
    >
      {items.map((item) => {
        const photo = (
          <ImageCard
            className={cn(
              aspectSp && "[--pc-ar:var(--pc-ar-sp)]",
              "lg:[--pc-ar:var(--pc-ar-pc)]"
            )}
            style={
              {
                "--pc-ar-sp": aspectSp ?? aspect,
                "--pc-ar-pc": aspect,
                aspectRatio: "var(--pc-ar, var(--pc-ar-pc))",
              } as React.CSSProperties
            }
            image={item.image}
            alt={item.imageAlt ?? ""}
            width={416}
            height={312}
            sizes="(max-width: 1024px) 100vw, 416px"
            hover={Boolean(item.href)}
          />
        );

        const body = (
          <>
            {item.overline ? (
              <p className={cn(overlineClass, "text-muted-foreground")}>
                {item.overline}
              </p>
            ) : null}
            <p
              className={cn(
                h4Class,
                "text-foreground",
                item.overline ? "mt-2" : "mt-4"
              )}
            >
              {item.title}
            </p>
            {item.note ? (
              <p className={cn(bodySmClass, "mt-1 text-muted-foreground")}>
                {item.note}
              </p>
            ) : null}
            {item.meta ? (
              <p className={cn(captionClass, "mt-1 text-muted-foreground")}>
                {item.meta}
              </p>
            ) : null}
          </>
        );

        return (
          <li data-slot="photo-card" key={item.key} className="group">
            {item.href ? (
              <Link href={item.href} className="block">
                {photo}
                <div className="underline-offset-4 group-hover:underline">
                  {body}
                </div>
              </Link>
            ) : (
              <>
                {photo}
                {body}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* TrackList — 収録曲 (Figma 8089:4563 / 8089:4667)                            */
/* -------------------------------------------------------------------------- */

export type TrackItem = {
  /** 通し番号ラベル (例「TRACK 01」)。 */
  no: React.ReactNode;
  title: React.ReactNode;
  note?: React.ReactNode;
};

/**
 * Figma 実測: 本文幅 640 (サイドバー無し)。1 曲ごとに
 * 番号 h17 (overline) → 4 → 曲名 h24 (h4) → 20 → メモ (body-sm)。
 * 曲間は 48。罫線は引かない (Figma 注記「罫線は1段階のみ」)。
 */
export function TrackList({
  items,
  className,
}: {
  items: readonly TrackItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <ol
      data-slot="track-list"
      className={cn("flex max-w-160 flex-col gap-12", className)}
    >
      {items.map((item, i) => (
        <li data-slot="track-row" key={i}>
          <p className={cn(overlineClass, "text-muted-foreground")}>{item.no}</p>
          <p className={cn(h4Class, "mt-1 text-foreground")}>{item.title}</p>
          {item.note ? (
            <p className={cn(bodySmClass, "mt-5 text-muted-foreground")}>
              {item.note}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
