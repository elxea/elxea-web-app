"use client";

import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ChatLauncher — floating chat entry point (bottom-right), both breakpoints
// ---------------------------------------------------------------------------

interface ChatLauncherProps {
  onClick: () => void;
  hasMessages: boolean;
}

/**
 * One launcher for desktop and mobile.
 *
 * Mobile keeps the 48px icon-only circle. Desktop grows the same button into a
 * labelled pill: desktop used to carry a permanently expanded 672px input bar,
 * so replacing it with a bare icon would be a real drop in discoverability. The
 * label is the cheap way to keep the affordance legible.
 *
 * Positioning notes:
 *  - `env(safe-area-inset-bottom)` is *added*, not `max()`-ed. On a home-
 *    indicator device `max(20px, 34px)` would pin the button flush against the
 *    indicator; adding keeps a real gap.
 *  - `--audio-bar-h` / `--consent-bar-h` / `--event-bar-h` are published by
 *    whichever bottom-fixed faces are currently on screen (audio dock, cookie
 *    banner, event register bar). They are *summed*, not `max()`-ed: the faces
 *    stack vertically. The stacking order's single source of truth is
 *    `hooks/use-bottom-stack-slot.ts`. Each defaults to 0px, so the normal case
 *    is untouched.
 */
export function ChatLauncher({ onClick, hasMessages }: ChatLauncherProps) {
  const t = useTranslations("chat");

  return (
    <Button
      data-slot="chat-launcher"
      variant="default"
      size="icon"
      onClick={onClick}
      aria-label={t("launcher.aria")}
      // 下端に居る面の高さを **全部** 足した分だけ持ち上げる。素の bottom
      // (20px) は音声バー (64px) の内側に入ってボタンが裏に隠れる。
      //
      // `--consent-bar-h` / `--event-bar-h` を足すのは 2026-08-18 の是正。
      // z だけで前に出すと (ランチャ 1030 > 同意バー 1020)、同意バーの
      // 「詳しく見る」がランチャに覆われて押せなくなる回帰が出た (重なり
      // 2304px^2 を QA が実測)。z を入れ替えても今度はランチャが覆われるだけで、
      // 勝てる並びが無い。**重ねないのが正解** なので幾何で解く。
      // 積み順の正本は hooks/use-bottom-stack-slot.ts。
      //
      // z は名前付きレイヤー (`app/globals.css` の `--z-*` が SoT)。生の
      // `z-40` は音声バーの `--z-sticky` (1020) に必ず負けるので使わない。
      //
      // 統合 (2026-08-18): 単一の `--bottom-obstruction` を 3 変数の積み上げに
      // 差し替えた。PC でもこのランチャがチャットへの唯一の入口なので (#55)、
      // `md:hidden` にはせず PC ではラベル付きのピルに育てる。
      style={{ zIndex: "var(--z-chat)" }}
      className={cn(
        "fixed right-4 size-12 rounded-full shadow-lg",
        "bottom-[calc(var(--audio-bar-h,0px)+var(--consent-bar-h,0px)+var(--event-bar-h,0px)+1.25rem+env(safe-area-inset-bottom,0px))]",
        // Desktop: labelled pill, slightly further from the viewport edges.
        "md:right-6 md:h-12 md:w-auto md:px-5",
        "md:bottom-[calc(var(--audio-bar-h,0px)+var(--consent-bar-h,0px)+var(--event-bar-h,0px)+1.5rem)]",
        // 音声バーの出入りに合わせて滑らかに上下する。ChatBar / Cookie バーと
        // 同じ指定にして、3つの下端要素が同じ速さで動くようにする。
        "transition-[bottom,transform] duration-fast ease-enter",
        "hover:scale-105 active:scale-95",
      )}
    >
      <MessageCircle className="size-5" />
      <span
        data-slot="chat-launcher-label"
        className="hidden md:inline text-sm"
      >
        {t("launcher.label")}
      </span>
      {hasMessages && (
        <span
          data-slot="chat-launcher-indicator"
          className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-secondary border-2 border-background"
        />
      )}
    </Button>
  );
}
