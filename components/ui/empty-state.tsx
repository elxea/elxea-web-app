import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { bodySmClass, captionClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * EmptyState — Figma `EmptyState+Icon (Module) — elxea/共通 空状態`
 * (8272:4460 / 原本 8173:298 の clone)。
 *
 * 「無い」ことを伝える枠。障害 (fetch 失敗) とは必ず出し分ける — こちらは
 * 再試行を促さず、次の一手 (絞り込みの解除・別の一覧) を促す。
 * 読み込みエラー (loadError) の表示には使わない。
 *
 * Figma 実測 (px) → 実装:
 * - 面     mode/card + radius-lg 8        → `bg-card rounded-lg`
 * - 余白   px 24 (space-6) / py 64 (space-16) → `px-6 py-16`
 * - 行間   16 (space-4)                   → `gap-4`
 * - 図     40x40 / 線 1.5 / muted-foreground → `size-10 stroke-[1.5]`
 * - 件数   caption 12 / muted-foreground   → `captionClass`
 * - 見出し h4 16 / 500 / 中央              → `data-slot="empty-state-title"`
 * - 本文   body-sm 14 / muted / 中央       → `bodySmClass`
 * - 導線   Button/Pill (outline) のインスタンス → 呼び出し側が `pillClass` で渡す
 *
 * 見出しは Figma の HUG ではなく FILL + 折り返し (`w-full`)。原本 8173:298 は
 * HUG のため SP 343 幅で左右パディング 24 を食い破り、文字がカード端に届いて
 * いた (原本インスタンス 8181:5505 で実測 → R1 で修正)。
 *
 * 本文は「原因 → 次の一手」の順で書くこと (Figma の注記)。
 */
export function EmptyState({
  /**
   * 状態を表す図。`lucide-react` の component をそのまま渡す (自作しない)。
   * P1 一覧が空 / P3 スコープ内が空 → `Sprout`、
   * P2 絞り込み該当 0 件 → `FilterX`、P4 自分の記録が空 → `NotebookPen`。
   */
  icon: Icon,
  /** 「該当 0 件」等の件数ラベル。 */
  count,
  title,
  body,
  /** Pill outline のリンク or ボタン。省略可。 */
  action,
  className,
}: {
  icon?: LucideIcon;
  count?: string;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex w-full flex-col items-center justify-center gap-4 rounded-lg bg-card px-6 py-16",
        className
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden
          data-slot="empty-state-icon"
          className="size-10 shrink-0 stroke-[1.5] text-muted-foreground"
        />
      ) : null}
      {count ? <p className={cn(captionClass, "text-muted-foreground")}>{count}</p> : null}
      <p data-slot="empty-state-title" className="w-full text-center text-foreground">
        {title}
      </p>
      {body ? (
        <p className={cn(bodySmClass, "w-full text-center text-muted-foreground")}>{body}</p>
      ) : null}
      {action}
    </div>
  );
}
