"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * ChatPanel — Figma `Chat / Panel (開いた状態・デスクトップ)` 6859:316。
 *
 * Figma 実測 (AWLnI0XF07e8rScuxPYPc7):
 * - symbol 6859:316 …… 480 x 302
 * - header 6859:317 …… h=32 / タイトル 6859:318 x=16 y=8 h=16 /
 *   閉じるアイコン 6859:319 x=450 w=14 h=14 (右余白 16)
 *   → `px-4` (16) + `py-2` (8) + 本文 16 = 32 で実測と一致
 * - 区切り 6859:321 …… header border-b 1px
 * - 本文 6859:322 …… y=33 h=204、バブル左右 16 / バブル間 12
 * - 区切り 6859:337 …… input border-t 1px
 * - 入力 6859:338 …… h=64、InputRow 6859:339 が inset 12 (12 + 40 + 12 = 64)
 *
 * コードとの構造差 (意図的・現状維持):
 * - 幅: Figma 480 はプレビュー幅。コードは `max-w-2xl` (672px) でデスクトップの
 *   実利用幅に合わせてある。最終的な幅は呼び出し側が `className` で決める。
 * - 入力行: Figma はパネル内 (border-t 付き) だが、コードでは入力バーをパネルの
 *   外に常時表示している (メッセージ 0 件でも入力できる要件のため)。本切り出しでは
 *   構造を変えずヘッダー + 本文だけを部品化した。入力行をパネル内へ入れるかは
 *   UX 判断なので別途起票する。
 *
 * 本部品は表示のみを持ち、開閉状態・メッセージ配列は呼び出し側 (chat-bar.tsx) が持つ。
 */
export type ChatPanelProps = Omit<React.ComponentProps<"div">, "title"> & {
  /** ヘッダーに出す名前 (Figma は "elxea assistant")。 */
  title: string;
  /** 閉じるボタンの押下。 */
  onClose: () => void;
  /** 閉じるボタンの読み上げラベル。 */
  closeLabel?: string;
  /** 本文 (メッセージ一覧)。 */
  children: React.ReactNode;
};

export function ChatPanel({
  title,
  onClose,
  closeLabel = "Close chat panel",
  className,
  children,
  ...props
}: ChatPanelProps) {
  return (
    <div
      data-slot="chat-panel"
      className={cn(
        "mx-auto w-full max-w-2xl",
        "rounded-t-2xl border border-border/40",
        "bg-background/80 backdrop-blur-xl",
        "shadow-lg",
        "transition-all duration-300",
        className,
      )}
      {...props}
    >
      {/* Panel header — Figma 6859:317 (h=32 = py-2 + 16 + py-2) */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={closeLabel}
        >
          {/* Figma 6859:319 は 14x14 → size-3.5 (0.875rem) */}
          <X className="size-3.5" />
        </Button>
      </div>

      {children}
    </div>
  );
}
