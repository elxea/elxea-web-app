import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Page skeleton primitives (C1 基盤).
 *
 * Figma が正本。数値はすべて `tokens/base.json` の layout.* / spacing.* トークン
 * 経由で解決し、このファイルには生 px を書かない。
 *
 * 実測根拠 (Figma AWLnI0XF07e8rScuxPYPc7):
 * - Header (Module) 5653:29 — 幅 1440 / ロゴ左端 x=64 / 右クラスタ右端 1376
 * - Footer (Module) 5662:49 — Footer / Content x=64 w=1312 / 上下 padding 64
 *   → 外余白 64px (layout.grid.margin.desktop) + 内容カラム 1312px (layout.container.xl)
 * - Footer / Columns — 292px 列 x4 + 48px gap x3 = 1312
 */

/** 内容カラムの幅。`.page-container*` は globals.css 側でトークンから算出される。 */
export type ContainerWidth = "wide" | "narrow" | "full";

const CONTAINER_WIDTH: Record<ContainerWidth, string> = {
  /** layout.container.xl (82rem = 1312px)。Header / Footer / 通常セクション。 */
  wide: "page-container",
  /** layout.container.md (48rem = 768px)。長文ページ (規約・FAQ 等)。 */
  narrow: "page-container-narrow",
  /** 幅制約なし。外余白 (--page-margin) のみ効かせる全幅セクション。 */
  full: "w-full page-inset",
};

export type ContainerProps = React.ComponentProps<"div"> & {
  width?: ContainerWidth;
};

/**
 * Container — 幅だけを担当する。縦リズムは `Section` に分離してあるので、
 * 「幅は同じだが余白だけ変えたい」ケースでトークン外の px を足さずに済む。
 */
export function Container({ width = "wide", className, ...props }: ContainerProps) {
  return (
    <div
      data-slot="container"
      data-container-width={width}
      className={cn(CONTAINER_WIDTH[width], className)}
      {...props}
    />
  );
}

/** セクション縦余白。spacing トークン (4 = 1rem 刻み) にのみ束縛する。 */
export type SectionSpacing = "none" | "sm" | "md" | "lg";

const SECTION_SPACING: Record<SectionSpacing, string> = {
  none: "",
  /** spacing.8 = 2rem (32px) */
  sm: "py-8",
  /** spacing.16 = 4rem (64px) — Figma Footer の上下 padding と同値 */
  md: "py-16",
  /** spacing.24 = 6rem (96px) — 見出し付き大セクション */
  lg: "py-24",
};

export type SectionProps = React.ComponentProps<"section"> & {
  width?: ContainerWidth;
  spacing?: SectionSpacing;
};

/**
 * Section — 幅 (Container と同じ規則) + 縦余白。ページ本体の既定ブロック。
 */
export function Section({
  width = "wide",
  spacing = "md",
  className,
  ...props
}: SectionProps) {
  return (
    <section
      data-slot="section"
      data-container-width={width}
      data-section-spacing={spacing}
      className={cn(CONTAINER_WIDTH[width], SECTION_SPACING[spacing], className)}
      {...props}
    />
  );
}

/**
 * Grid — layout.grid トークンそのままの 4 / 8 / 12 カラム基準グリッド。
 * カラム数 (4/8/12) と溝 (1rem / 1.5rem / 2rem) と切替点 (48rem / 64rem) は
 * すべて layout.grid.columns / layout.grid.gutter / layout.breakpoint に一致する。
 */
export function Grid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="grid"
      className={cn(
        "grid grid-cols-4 gap-4 md:grid-cols-8 md:gap-6 lg:grid-cols-12 lg:gap-8",
        className
      )}
      {...props}
    />
  );
}

/** 等幅カラム束 (カード列・フッターリンク列)。SP は常に 1 列に落ちる。 */
export type ColumnsCount = 2 | 3 | 4 | 5;
export type ColumnsGap = "sm" | "md" | "lg";

const COLUMNS_COUNT: Record<ColumnsCount, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
  5: "md:grid-cols-5",
};

const COLUMNS_GAP: Record<ColumnsGap, string> = {
  /** spacing.6 = 1.5rem (24px) */
  sm: "gap-6",
  /** spacing.8 = 2rem (32px) — layout.grid.gutter.desktop と同値 */
  md: "gap-8",
  /** spacing.12 = 3rem (48px) — component.footer.column.gap と同値 (Figma Footer / Columns) */
  lg: "gap-12",
};

export type ColumnsProps = React.ComponentProps<"div"> & {
  count?: ColumnsCount;
  gap?: ColumnsGap;
};

export function Columns({
  count = 3,
  gap = "md",
  className,
  ...props
}: ColumnsProps) {
  return (
    <div
      data-slot="columns"
      className={cn("grid grid-cols-1", COLUMNS_COUNT[count], COLUMNS_GAP[gap], className)}
      {...props}
    />
  );
}
