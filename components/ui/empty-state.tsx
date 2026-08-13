import * as React from "react";

import { bodySmClass, captionClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * EmptyState — Figma `EmptyState (Module) — elxea/共通 該当0件` (8173:298)。
 *
 * 「絞り込みの結果として無い」ことを伝える枠。障害 (fetch 失敗) とは必ず
 * 出し分ける — こちらは再試行を促さず、絞り込みの解除を促す
 * (Figma の component description そのまま)。読み込みエラーの表示には使わない。
 *
 * Figma 実測 (px) → 実装:
 * - 面     mode/card + radius-lg 8      → `bg-card rounded-lg`
 * - 余白   px 24 / py 64                 → `px-6 py-16`
 * - 行間   16                            → `gap-4`
 * - 件数   caption 12 / muted-foreground → `captionClass`
 * - 見出し h4 16 / 500 / 中央            → `data-slot="empty-state-title"`
 * - 本文   body-sm 14 / muted / 中央     → `bodySmClass`
 * - 導線   Button/Pill (outline) のインスタンス → 呼び出し側が `pillClass` で渡す
 *
 * 本文は「原因 → 次の一手」の順で書くこと (Figma の注記)。
 */
export function EmptyState({
  /** 「該当 0 件」等の件数ラベル。 */
  count,
  title,
  body,
  /** Pill outline のリンク or ボタン。省略可。 */
  action,
  className,
}: {
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
      {count ? <p className={cn(captionClass, "text-muted-foreground")}>{count}</p> : null}
      <p data-slot="empty-state-title" className="text-center text-foreground">
        {title}
      </p>
      {body ? (
        <p className={cn(bodySmClass, "text-center text-muted-foreground")}>{body}</p>
      ) : null}
      {action}
    </div>
  );
}
