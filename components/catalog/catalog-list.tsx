import * as React from "react";

import { Link } from "@/i18n/navigation";
import { ImageCard } from "@/components/media/image-card";
import { MoreRowProgress } from "@/components/catalog/more-row-progress";
import { pillClass } from "@/components/ui/pill-button";
import {
  bodySmClass,
  captionClass,
  h4Class,
  overlineClass,
} from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * Catalog list primitives (C3 基盤).
 *
 * Figma が正本 — 【R2: 確定版】共通リストパターン。
 * 商品一覧 (PC 8061:1781 / SP 8062:2008) と お茶メニュー (PC 8063:2144 /
 * SP 8063:2372) は同一骨格なので、ページ側に持たずここで共有する。
 *
 * Figma 実測 (px) → 実装の対応:
 * - ブロック間の縦間隔  PC 48 / SP 32          → `mt-8 lg:mt-12`
 * - PageHead 内 gap     12                      → `gap-3`
 * - Chip                h44 / PC px16 py8 / SP px12 py12 / gap8 / 全丸め
 * - Grid                PC 3列 416 gap-x32 gap-y48 / SP 2列 163.5 gap-x16 gap-y24
 * - Card                image aspect 3/2 → gap PC20 SP12 → info gap8、左寄せ
 * - MoreRow             h48 / 全丸め / 中央
 *
 * 値の出どころ: 文字組みは `typography.style.*` トークン (rule-list と同じ
 * CSS 変数を再輸出して使う)。色は semantic token。寸法は Tailwind spacing
 * scale (= spacing.* トークンと同じ 0.25rem 刻み)。生 px・生カラーは書かない。
 *
 * 既知の差分 (忠実度対比表の【要判断】と対応):
 * - Figma の h1 は PC 52px / SP 30px だが、共有トークン `typography.style.h1`
 *   は 32px 固定。CJK 文字組みトークンは Setaka 判断待ちのため動かさない。
 */

/* -------------------------------------------------------------------------- */
/* ListPageHead — 英字キッカー + 日本語見出し + リード (Figma 8061:1785)        */
/* -------------------------------------------------------------------------- */

export type ListPageHeadProps = {
  /** 英字キッカー (Figma "ALL PRODUCTS" / "TEA MENU")。 */
  overline: string;
  /** 日本語見出し。 */
  title: string;
  /** 見出し下のリード 1 行。 */
  lead?: string;
  className?: string;
};

export function ListPageHead({ overline, title, lead, className }: ListPageHeadProps) {
  return (
    /* 段間は R2 共通リストパターンの実測どおり BP で分ける (SP 8 / PC 12)。
       Figma: PC 8061:1785 は キッカー→見出し 12・見出し→リード 12、
       SP 8062:2008 / 8063:2377 はどちらも 8。C9-1 注3 / C12-1 / C13-1 が
       同じ「SP 8 に対して実装 12」を [粗] として記録していたのを閉じる
       (R2リスト系の全画面が同じ値になるので画面ごとの分岐は作らない)。 */
    <div data-slot="list-page-head" className={cn("flex flex-col gap-2 lg:gap-3", className)}>
      <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
      {/* R2 共通リストパターンの PageHead 見出しは h1 プリセット (32px) ではなく
          ページタイトル級。Figma 8061:1787「商品一覧」= w212 h73 で、束ねられた
          変数は elxea/typography/functional/jp/h1 (52px / lh 1.4)。DS (editorial
          スケール) の最大は display トークン 44px なので、生 px を足さずに既存の
          .page-title (md+ で display トークン / lh 1.2) を当てる。同じ R2 パターン
          配下の詳細ページ (collections/[handle]・elxea-journal) と同一実装になる。
          SP は base h1 32px のまま (.page-title は md+ のみ)。 */}
      <h1 className="page-title text-foreground">{title}</h1>
      {lead ? <p className={cn(captionClass, "text-muted-foreground")}>{lead}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* CatalogGrid — SP 2列 / PC 3列 (Figma 8061:1806 / 8062:2094)                  */
/* -------------------------------------------------------------------------- */

export function CatalogGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="catalog-grid"
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-6 lg:grid-cols-3 lg:gap-x-8 lg:gap-y-12",
        className
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* CatalogCard — 写真 + 情報 3 行 (Figma ProductCard (Proposed) 5270:3 系)      */
/* -------------------------------------------------------------------------- */

export type CatalogCardProps = {
  /**
   * 詳細ルートがあるときだけ渡す。省略すると**同じ体裁のまま非リンク**で出す。
   * 農家一覧の見本カード (preview seed の `seed-farmer-N`) は
   * `/ja/farmers/[slug]` に実ドキュメントが無く notFound になるため、
   * リンクを張らずにグリッド密度だけ再現する用途で使う。
   * 既存の呼び出し (商品一覧 / お茶メニュー / PDP の近い茶葉) は必ず渡すので
   * 表示は不変。
   */
  href?: string;
  image?: string;
  imageAlt?: string;
  /** 産地・カテゴリ等の英字/日本語キッカー。 */
  overline?: React.ReactNode;
  title: string;
  /** タイトル下の 1 行 (価格・品種 · 産地 など)。 */
  meta?: React.ReactNode;
  /** meta の下に積む補足 (在庫バッジ等)。 */
  footer?: React.ReactNode;
  /** ImageCard に渡すインラインスタイル (お茶メニューの色見本用)。 */
  imageStyle?: React.CSSProperties;
  className?: string;
};

export function CatalogCard({
  href,
  image,
  imageAlt,
  overline,
  title,
  meta,
  footer,
  imageStyle,
  className,
}: CatalogCardProps) {
  const frameClass = cn("group flex flex-col gap-3 lg:gap-5", className);

  const inner = (
    <>
      <ImageCard
        image={image}
        alt={imageAlt ?? title}
        style={imageStyle}
        hover={Boolean(href)}
      />
      <div className="flex flex-col items-start gap-2 text-left">
        {overline ? (
          <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
        ) : null}
        {/* 体裁は h4 プリセット (Figma ProductCard / Info)。要素は文書構造上 h2。
            globals.css の `h2 { font: … }` が unlayered で utilities に勝つため、
            体裁は同ファイルの `h2[data-slot="catalog-card-title"]` 規則で当てる。 */}
        <h2
          data-slot="catalog-card-title"
          className={cn(
            h4Class,
            "text-foreground",
            href && "underline-offset-4 group-hover:underline"
          )}
        >
          {title}
        </h2>
        {meta ? <div className={cn(bodySmClass, "text-foreground")}>{meta}</div> : null}
        {footer}
      </div>
    </>
  );

  if (!href) {
    return (
      <div data-slot="catalog-card" data-linked="false" className={frameClass}>
        {inner}
      </div>
    );
  }

  return (
    <Link href={href} data-slot="catalog-card" className={frameClass}>
      {inner}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* KindIndex — SP 専用「種類から探す」2 列テキスト (Figma 8062:2077)            */
/* -------------------------------------------------------------------------- */

export type KindIndexEntry = { label: string; count: number; href: string };

export function KindIndex({
  title,
  entries,
  className,
}: {
  title: string;
  entries: KindIndexEntry[];
  className?: string;
}) {
  if (entries.length === 0) return null;

  return (
    <nav
      data-slot="kind-index"
      aria-label={title}
      className={cn("lg:hidden", className)}
    >
      <p className={cn(captionClass, "text-muted-foreground")}>{title}</p>
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {entries.map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className={cn(bodySmClass, "text-foreground underline-offset-4 hover:underline")}
            >
              {entry.label} ({entry.count})
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* MoreRow — 「さらに N 件を表示」ピル (Figma 8061:2008)                        */
/* -------------------------------------------------------------------------- */

export function MoreRow({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <div data-slot="more-row" className={cn("flex justify-center", className)}>
      {/* Figma `Button / Pill (Module)` 8171:286 の注記「Journal R2 の手作り
          『Button / もっと見る (pill)』フレーム群は本部品のインスタンスへ
          置換すること」に従い、手組みの pill を DS 部品へ寄せる。
          hover / active / disabled は pillClass が一括で持つ。

          `prefetch` を明示しているのは、この行き先が `?show=` 付きの動的な
          ページで、既定 (auto) では**中身まで温まらない**ため (網羅表 G6)。
          この pill は一覧のいちばん下に居るので、先読みが走るのは客がそこまで
          スクロールしたとき = まさに押す直前で、無駄撃ちになりにくい。
          進行の印は `MoreRowProgress` が `useLinkStatus` で出す。 */}
      <Link href={href} prefetch className={pillClass("outline")} data-slot="more-row-link">
        <MoreRowProgress label={label} />
      </Link>
    </div>
  );
}
