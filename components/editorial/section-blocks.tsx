import * as React from "react";

import {
  bodySmClass,
  captionClass,
  h4Class,
  overlineClass,
} from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * R2 セクション骨格 (C3-2 基盤).
 *
 * Figma が正本 — 【R2: 確定版】商品詳細 (PC 8056:1517 / SP 8057:1700) と
 * 定期便LP (PC 8071:2 / SP 8073:2)。両ページは同じ骨格 (見出し / 4カラム定義帯 /
 * 3カラム / 2カラム台帳 / 開いたままの FAQ) を共有するので、ページ側ではなく
 * ここに置いて共有する。
 *
 * Figma 実測 (px) → 実装の対応:
 * - セクション上下余白      PC 64 / SP 32            → `py-8 lg:py-16`
 * - 見出し overline→title   PC 8 / SP 20             → `mt-5 lg:mt-2`
 * - 見出し→本体            PC 32 / SP 20            → `mt-5 lg:mt-8`
 * - SpecBand 罫線→行        PC 32 / SP 16            → `pt-4 lg:pt-8`
 * - SpecBand 列             PC 4列 304 gap32 / SP 2列 163.5 gap16
 * - TripleColumn            PC 3列 416 gap32 / SP 縦積み gap20
 * - Ledger 行               PC h48 term160 gap24 / SP h45 term104 gap16
 * - FAQ 行                  PC pt20/pb20 / SP pt16/pb16、回答 max 864
 *
 * 値の出どころ: 文字組みは `typography.style.*` トークン (rule-list から再輸出
 * された CSS 変数)。色は semantic token。寸法は Tailwind spacing scale
 * (= spacing.* トークンと同じ 0.25rem 刻み)。生 px・生カラーは書かない。
 */

/* -------------------------------------------------------------------------- */
/* PageSection — 外余白 + 上下余白つきのセクション枠                            */
/* -------------------------------------------------------------------------- */

export type PageSectionProps = React.ComponentProps<"section"> & {
  /** 罫線・背景を持たない素の帯にしたいとき (章切りなど) は false。 */
  contained?: boolean;
};

export function PageSection({
  className,
  contained = true,
  ...props
}: PageSectionProps) {
  return (
    <section
      data-slot="page-section"
      className={cn(contained && "page-container", "py-8 lg:py-16", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* SectionHead — 英字キッカー + 日本語見出し (Figma 8056:1574 / 8071:133)       */
/* -------------------------------------------------------------------------- */

export type SectionHeadProps = {
  overline: React.ReactNode;
  /** 見出しが無い節 (SPECIFICATION / FAQ / 12 MONTHS) は省略する。 */
  title?: React.ReactNode;
  className?: string;
  /** 見出しレベル。既定 h2 (ページ内の節見出し)。 */
  as?: "h2" | "h3";
};

export function SectionHead({
  overline,
  title,
  className,
  as: Tag = "h2",
}: SectionHeadProps) {
  return (
    <div data-slot="section-head" className={cn(className)}>
      <p className={cn(overlineClass, "text-muted-foreground")}>{overline}</p>
      {title ? (
        <Tag
          data-slot="section-title"
          className={cn(
            /* 体裁は h3 プリセット。globals.css の unlayered な `h2 { font: … }` が
               utilities に勝つため、体裁は同ファイルの
               `h2[data-slot="section-title"]` 規則で当てる (catalog-card-title と同型)。 */
            "mt-5 lg:mt-2"
          )}
        >
          {title}
        </Tag>
      ) : null}
    </div>
  );
}

/** 見出しの下に置く本体ブロックの共通マージン (Figma PC 32 / SP 20)。 */
export function SectionBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="section-body" className={cn("mt-5 lg:mt-8", className)} {...props} />
  );
}

/** 節末の注記 (Figma 8056:1667 / 8056:1607)。断定しない補足文。 */
export function SectionNote({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="section-note"
      className={cn(captionClass, "mt-5 max-w-216 text-muted-foreground lg:mt-8", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* SpecBand — 4カラム定義帯 (Figma 8056:1558 / 8071:149 / 8071:462)             */
/* PC 4列 304 gap32 / SP 2列 163.5 gap16。上に罫線 1 本。                       */
/* -------------------------------------------------------------------------- */

export type SpecItem = { term: React.ReactNode; value: React.ReactNode };

export function SpecBand({
  items,
  className,
}: {
  items: readonly SpecItem[];
  className?: string;
}) {
  return (
    <dl
      data-slot="spec-band"
      className={cn(
        "grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4",
        "lg:grid-cols-4 lg:gap-x-8 lg:pt-8",
        className
      )}
    >
      {items.map((item, i) => (
        <div data-slot="spec-item" key={i}>
          <dt className={cn(captionClass, "text-muted-foreground")}>{item.term}</dt>
          <dd className={cn(bodySmClass, "m-0 mt-1 text-foreground lg:mt-2")}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* TripleColumn — 罫線つき 3 カラム (Figma 8056:1577 / 8071:136 / 8071:481)     */
/* PC 3列 416 gap32 / SP 縦積み gap20。各列の上に罫線 1 本。                    */
/* -------------------------------------------------------------------------- */

export type TripleItem = { title: React.ReactNode; body: React.ReactNode };

export function TripleColumn({
  items,
  className,
}: {
  items: readonly TripleItem[];
  className?: string;
}) {
  return (
    <div
      data-slot="triple-column"
      className={cn("grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-8", className)}
    >
      {items.map((item, i) => (
        <div
          data-slot="triple-item"
          key={i}
          className="border-t border-border pt-2 lg:pt-3"
        >
          <p className={cn(h4Class, "text-foreground")}>{item.title}</p>
          <p className={cn(bodySmClass, "mt-2 text-muted-foreground lg:mt-3")}>
            {item.body}
          </p>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ledger — 2カラム台帳 (Figma 8056:1670 / 8072:119)                            */
/* PC は 2 カラムに折り返す (gap 64) / SP は 1 カラム。行は罫線で区切る。        */
/* -------------------------------------------------------------------------- */

export type LedgerRow = { term: React.ReactNode; value: React.ReactNode };

export function Ledger({
  rows,
  columns = 2,
  className,
}: {
  rows: readonly LedgerRow[];
  /** PC のカラム数。定期便の 12ヶ月 / PDP のフルスペックはどちらも 2。 */
  columns?: 1 | 2;
  className?: string;
}) {
  const half = Math.ceil(rows.length / columns);
  const groups =
    columns === 1 ? [rows] : [rows.slice(0, half), rows.slice(half)].filter((g) => g.length);

  return (
    <div
      data-slot="ledger"
      className={cn(
        "grid grid-cols-1",
        columns === 2 && "lg:grid-cols-2 lg:gap-x-16",
        className
      )}
    >
      {groups.map((group, gi) => (
        <dl data-slot="ledger-column" key={gi} className="border-b border-border">
          {group.map((row, i) => (
            <div
              data-slot="ledger-row"
              key={i}
              className="flex flex-wrap gap-x-4 border-t border-border py-2.5 lg:gap-x-6 lg:py-3"
            >
              <dt className={cn(h4Class, "w-26 shrink-0 text-foreground lg:w-40")}>
                {row.term}
              </dt>
              <dd className={cn(bodySmClass, "m-0 flex-1 text-muted-foreground")}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* OpenFaqList — アコーディオンなしの FAQ (Figma 8056:1717 / 8071:496)          */
/* 全行を開いたまま出す。回答は PC 864 幅で折り返す。                           */
/* -------------------------------------------------------------------------- */

export type FaqItem = { q: React.ReactNode; a: React.ReactNode };

export function OpenFaqList({
  items,
  className,
}: {
  items: readonly FaqItem[];
  className?: string;
}) {
  return (
    <dl data-slot="open-faq" className={cn("border-b border-border", className)}>
      {items.map((item, i) => (
        <div
          data-slot="open-faq-row"
          key={i}
          className="border-t border-border pt-4 pb-4 lg:pt-5 lg:pb-5"
        >
          <dt className={cn(h4Class, "text-foreground")}>{item.q}</dt>
          <dd className={cn(bodySmClass, "m-0 mt-2 max-w-216 text-muted-foreground")}>
            {item.a}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* ValueCards — 中央寄せ 2 カラムの対比カード (Figma About R2 8121:1284)        */
/* PC 2列 640 gap32 / 行ピッチ 144。SP 1列 343 / 行ピッチ 112。                  */
/* -------------------------------------------------------------------------- */

export type ValueCardItem = {
  /** 「決めていること」「決めていないこと」のような区分ラベル。 */
  title: React.ReactNode;
  /** その区分の中身 1 行。 */
  body: React.ReactNode;
};

/**
 * 新規部品にした理由: 既存の対比系部品 (`PairRow` / `DefinitionRow` / `SpecBand`) は
 * すべて**罫線つき・左寄せ**で、About R2 の ValueCard は**罫線なし・中央寄せ**の
 * 独立カードだった (Figma 8121:1287 系。カード内 padding 16 / タイトル h24 →
 * 本文 h21 の間 12 / カード高 PC 112・SP 96)。既存部品に `align="center"` と
 * 「罫線を消す」を同時に足すと、罫線が骨格の一部になっている FAQ・配送情報・
 * 特商法の行型まで意味が壊れるため、別部品として分けた。
 */
export function ValueCards({
  items,
  className,
}: {
  items: readonly ValueCardItem[];
  className?: string;
}) {
  return (
    <ul
      data-slot="value-cards"
      className={cn("grid grid-cols-1 gap-y-4 lg:grid-cols-2 lg:gap-x-8 lg:gap-y-8", className)}
    >
      {items.map((item, i) => (
        <li
          data-slot="value-card"
          key={i}
          /* Figma 実測: 内 padding 16、下だけ SP 24 / PC 40 (カード高 96 / 112)。 */
          className="p-4 pb-6 text-center lg:pb-10"
        >
          <p className={cn(h4Class, "text-foreground")}>{item.title}</p>
          <p className={cn(bodySmClass, "mt-3 text-muted-foreground")}>{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* StepCards — 番号つき 3 ステップ (Figma 8056:1594 / SP 8057:1774)             */
/* PC 3列 416 gap32 / SP 縦積み。枠は muted 面。                                */
/* -------------------------------------------------------------------------- */

export type StepCardItem = {
  step: React.ReactNode;
  name: React.ReactNode;
  body: React.ReactNode;
};

export function StepCards({
  items,
  className,
}: {
  items: readonly StepCardItem[];
  className?: string;
}) {
  return (
    <ol
      data-slot="step-cards"
      className={cn("grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-8", className)}
    >
      {items.map((item, i) => (
        <li data-slot="step-card" key={i} className="bg-muted p-5 lg:p-6">
          <p className={cn(overlineClass, "text-muted-foreground")}>{item.step}</p>
          <p className={cn(h4Class, "mt-2 text-foreground")}>{item.name}</p>
          <p className={cn(bodySmClass, "mt-2 text-muted-foreground")}>{item.body}</p>
        </li>
      ))}
    </ol>
  );
}
