"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ReactionChip — Figma `ReactionChip (Proposed) — elxea/みんなの気配 選択式リアクション`
 * 7840:39256。
 *
 * Figma 実測 (AWLnI0XF07e8rScuxPYPc7):
 * - Size=pc 7840:39252 …… 76 x 45
 * - Size=sp 7840:39255 …… 76 x 53
 *
 * 選択式 (自由入力ではない) なので意味論はトグルボタン。押下状態は `aria-pressed`
 * で表し、見た目だけで状態を伝えない。高さは
 * `component.reactionChip.height.*` トークンに束縛する。PC 45 / SP 53 はどちらも
 * 最小タッチ域 44px を満たす。
 */
export type ReactionChipProps = Omit<
  React.ComponentProps<"button">,
  "children"
> & {
  /** チップの表示ラベル (例「わかる」「いいな」「気になる」)。 */
  label: string;
  /** 選択済みか。制御コンポーネントとして呼び出し側が状態を持つ。 */
  pressed?: boolean;
  /** 選択件数。0 のときは出さない。 */
  count?: number;
};

export function ReactionChip({
  label,
  pressed = false,
  count,
  className,
  type = "button",
  ...props
}: ReactionChipProps) {
  return (
    <button
      type={type}
      data-slot="reaction-chip"
      aria-pressed={pressed}
      className={cn(
        // 高さ: SP 53px → PC 45px (component.reactionChip.height.*)
        "h-(--component-reactionChip-height-sp) sm:h-(--component-reactionChip-height-pc)",
        "inline-flex items-center justify-center gap-1 rounded-full border px-4 text-sm whitespace-nowrap",
        // フォーカスリングはスケール値 (ring-2) を使う。shadcn の button は
        // ring-[3px] だが、生値禁止の lint 規律をこちら側では優先する。
        "transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        pressed
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    >
      <span>{label}</span>
      {typeof count === "number" && count > 0 && (
        /* 件数は opacity で薄くしない — 前景色に alpha が乗ると WCAG AA 4.5:1 を
           割り、addon-a11y (color-contrast, test:"error") が落ちる。 */
        <span className="tabular-nums">{count}</span>
      )}
    </button>
  );
}
