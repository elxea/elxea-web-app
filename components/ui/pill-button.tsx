import * as React from "react";

import { bodySmClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * PillButton — Figma `Button / Pill (Module) — elxea/共通` (8171:286)。
 *
 * Figma が正本。8 バリアント (style 2 x state 4) を 1 部品にまとめる。
 * state は Figma では明示バリアントだが、実装では CSS の擬似クラスに落とす
 * (hover / active / disabled は DOM の状態であって prop ではない)。
 * 「Figma に 4 状態あるのに実装は default だけ」という乖離を作らないため、
 * 4 状態すべてをここで定義し、利用側は style だけを選ぶ。
 *
 * Figma 実測 (px) → 実装:
 * - 高さ            48 (component description「高さ 48 = space-12」) → `min-h-12`
 * - padding         24 x 12                                        → `px-6 py-3`
 * - 角丸            radius-full                                    → `rounded-full`
 * - 文字            body-sm 14 / 行高 1.8                          → `bodySmClass`
 * - solid  default  mode/primary                → `bg-primary`
 *          hover    brand/charcoal   (#5d5e61)  → `bg-brand-charcoal`
 *          active   state/graphite-pressed (#35363a) → `bg-graphite-pressed`
 *          disabled mode/muted + 不透明度 60%   → `bg-muted opacity-60`
 * - outline default 1px mode/border             → `border border-border`
 *          hover    mode/muted 面               → `bg-muted`
 *          active   mode/secondary 面           → `bg-secondary`
 *          disabled 1px mode/input + 不透明度 60% → `border-input opacity-60`
 *
 * Figma に無いが実装で足すもの: `focus-visible` のリング。Figma の Pill には
 * focus バリアントが無いが、キーボード利用者に押下対象が見えないのは
 * a11y 上の欠落なので、同じ DS の Chip (8171:269) が持つ focus (2px / ring)
 * と同じ表現を当てる。DS 側は次回改訂で Pill にも focus を追加すること。
 */

const pillBase = cn(
  bodySmClass,
  "inline-flex min-h-12 items-center justify-center rounded-full px-6 py-3 text-center whitespace-nowrap",
  "transition-colors duration-fast",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
  "disabled:pointer-events-none disabled:opacity-60",
  "aria-disabled:pointer-events-none aria-disabled:opacity-60"
);

const pillStyles = {
  solid: cn(
    "bg-primary text-primary-foreground",
    "hover:bg-brand-charcoal",
    "active:bg-graphite-pressed",
    "disabled:bg-muted disabled:text-muted-foreground",
    "aria-disabled:bg-muted aria-disabled:text-muted-foreground"
  ),
  outline: cn(
    "border border-border text-foreground",
    "hover:bg-muted",
    "active:bg-secondary",
    "disabled:border-input disabled:text-muted-foreground disabled:hover:bg-transparent",
    "aria-disabled:border-input aria-disabled:text-muted-foreground"
  ),
} as const;

export type PillStyle = keyof typeof pillStyles;

/** 素の `<button>` として使う (モーダルのフッター・空状態のアクション等)。 */
export function PillButton({
  pillStyle = "solid",
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & { pillStyle?: PillStyle }) {
  return (
    <button
      type={type}
      data-slot="pill-button"
      data-pill-style={pillStyle}
      className={cn(pillBase, pillStyles[pillStyle], className)}
      {...props}
    />
  );
}

/**
 * リンクや `<Link>` を Pill の見た目にするためのクラス。要素を差し替えたいときに
 * `className={pillClass("outline")}` で使う (見た目の定義を二重に持たない)。
 */
export function pillClass(pillStyle: PillStyle = "solid", className?: string) {
  return cn(pillBase, pillStyles[pillStyle], className);
}
