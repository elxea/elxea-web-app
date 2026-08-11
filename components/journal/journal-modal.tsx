"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { captionClass } from "@/components/editorial/rule-list";
import { PillButton } from "@/components/ui/pill-button";
import { cn } from "@/lib/utils";

/**
 * JournalModal — Figma `Modal (Module) — elxea/共通 ページ内モーダル` (8172:280)。
 *
 * 「読みものを読み進めている途中で、ページを離れずに補足を開く」ための器。
 * shadcn/dialog (`components/ui/dialog.tsx`) は素の器で、余白・面・角丸・
 * フッターの構えがブランドと合わないため、Radix の primitive (フォーカストラップ /
 * Esc / スクリムクリック / `aria-modal` を担う層) だけを共有し、見た目は
 * Figma 実測でここに組み直す。素組みの DialogContent は使わない。
 *
 * Figma 実測 (px) → 実装:
 * - PC   幅 720 / 角丸 radius-lg 8 / 画面中央      → `lg:w-180 lg:rounded-lg` + 中央寄せ
 * - SP   幅全幅 / 上二隅 radius-2xl 16 / 下端吸着   → `rounded-t-2xl` + `inset-x-0 bottom-0`
 * - 面   mode/popover                              → `bg-popover`
 * - 影   0 12px 40px graphite 18%                   → `--elevation-shadow-modal`
 * - 3 段 ヘッダー / 本文 (ここだけスクロール) / フッター 固定
 *   ヘッダー PC pt24 px32 pb16 / SP pt20 px20 pb16
 *   本文     PC py24 px32     / SP py24 px20      内部 gap 16
 *   フッター PC pt16 pb24 px32 右寄せ / SP pt16 pb20 px20 中央・ボタン FILL
 * - 罫   1px mode/border                            → `h-px bg-border`
 * - 閉じる 44px タップ域 (Foundations R1)            → `size-11`
 * - スクリム mode/overlay-scrim (graphite 62%)       → `bg-overlay-scrim`
 * - z    overlay 1040 → modal 1050                  → `--z-overlay` / `--z-modal`
 *
 * deep-link は持たない (モーダルは閲覧補助であって、それ自体が到達先ではない)。
 * URL に状態を載せないので、戻る操作はページ遷移として素直に働く。
 *
 * SP のボトムシートは高さを `85dvh` で止める。`vh` ではなく `dvh` にしているのは、
 * モバイル Safari のアドレスバー可変分でフッター (= 閉じる導線) が画面外へ
 * 押し出されるのを防ぐため。
 */

export type JournalModalProps = {
  /**
   * モーダルを開く要素。`asChild` で渡すのでフォーカス可能な単一要素にすること。
   * 複数の行から 1 つのモーダルを開き分ける場合は trigger を省略し、
   * `open` / `onOpenChange` で外から制御する。
   */
  trigger?: React.ReactNode;
  /** 制御モード。省略すると trigger による非制御モードになる。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 見出しの上に出る小見出し (Figma「この号に入っているお茶」の位置)。 */
  kicker?: string;
  title: string;
  /** 支援技術向けの説明。視覚的には出さない。 */
  description?: string;
  /** フッター左 (SP は上) の閉じるボタンの文言。 */
  closeLabel: string;
  /** フッター右の主導線。省略すると閉じるだけのフッターになる。 */
  primaryAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function JournalModal({
  trigger,
  open,
  onOpenChange,
  kicker,
  title,
  description,
  closeLabel,
  primaryAction,
  children,
  className,
}: JournalModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="journal-modal-overlay"
          style={{ zIndex: "var(--z-overlay)" }}
          className={cn(
            "fixed inset-0 bg-overlay-scrim",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          )}
        />
        <DialogPrimitive.Content
          data-slot="journal-modal"
          style={{ zIndex: "var(--z-modal)", boxShadow: "var(--elevation-shadow-modal)" }}
          className={cn(
            // SP: 画面下端に吸着するボトムシート。
            "fixed inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden",
            "rounded-t-2xl bg-popover outline-none",
            // PC: 画面中央の 720 幅カード。左右に最低 32 の余白を残す。
            "lg:inset-x-auto lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2",
            "lg:max-h-[80dvh] lg:w-180 lg:max-w-[calc(100vw-4rem)] lg:rounded-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-4",
            "lg:data-[state=open]:zoom-in-95 lg:data-[state=open]:slide-in-from-bottom-0",
            "lg:data-[state=closed]:zoom-out-95 lg:data-[state=closed]:slide-out-to-bottom-0",
            className
          )}
        >
          {/* ヘッダー — 見出し + 閉じる (44px タップ域) */}
          <div className="flex shrink-0 items-center gap-4 px-5 pt-5 pb-4 lg:px-8 lg:pt-6">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {kicker ? (
                <p className={cn(captionClass, "text-muted-foreground")}>{kicker}</p>
              ) : null}
              <DialogPrimitive.Title data-slot="modal-title" className="text-foreground">
                {title}
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close
              data-slot="journal-modal-close"
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-full text-foreground",
                "transition-colors duration-200 hover:bg-muted active:bg-secondary",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              )}
            >
              <XIcon aria-hidden="true" className="size-4" />
              <span className="sr-only">{closeLabel}</span>
            </DialogPrimitive.Close>
          </div>

          {/* Radix は Description が無いと開発時に警告を出す。視覚には出さない。 */}
          <DialogPrimitive.Description className="sr-only">
            {description ?? title}
          </DialogPrimitive.Description>

          <div aria-hidden="true" className="h-px w-full shrink-0 bg-border" />

          {/* 本文 — 縦に溢れるのはここだけ。ヘッダーとフッターは固定のまま。 */}
          <div
            data-slot="journal-modal-body"
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-6 lg:px-8"
          >
            {children}
          </div>

          {/* フッター — SP はボタンを FILL にして親指到達域に置く。 */}
          <div className="flex shrink-0 items-center justify-center gap-3 bg-card px-5 pt-4 pb-5 lg:justify-end lg:px-8 lg:pb-6">
            <DialogPrimitive.Close asChild>
              <PillButton pillStyle="outline" className="flex-1 lg:flex-none">
                {closeLabel}
              </PillButton>
            </DialogPrimitive.Close>
            {primaryAction}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * モーダル本文の「階層リンク」1 行 (Figma 8175:352 / 8184:353 の detail row)。
 * 高さ 48 のタップ域 + 下 1px の hairline。押すと同じモーダル内でさらに潜る、
 * または外部へ遷移する。
 */
export function ModalDetailRow({
  label,
  className,
  ...props
}: React.ComponentProps<"button"> & { label: React.ReactNode }) {
  return (
    <>
      <button
        type="button"
        data-slot="modal-detail-row"
        className={cn(
          "flex min-h-12 w-full items-center gap-4 py-3 text-left text-foreground",
          "transition-colors duration-200 hover:text-muted-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          className
        )}
        {...props}
      >
        <span className="min-w-0 flex-1">{label}</span>
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          &#9656;
        </span>
      </button>
      <span aria-hidden="true" className="block h-px w-full bg-border" />
    </>
  );
}
