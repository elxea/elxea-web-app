"use client";

import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ChatLauncher — Mobile-only floating action button (bottom-right)
// ---------------------------------------------------------------------------

interface ChatLauncherProps {
  onClick: () => void;
  hasMessages: boolean;
}

export function ChatLauncher({ onClick, hasMessages }: ChatLauncherProps) {
  return (
    <Button
      data-slot="chat-launcher"
      variant="default"
      size="icon"
      onClick={onClick}
      aria-label="Open chat"
      // 下端に居る面の高さを **全部** 足した分だけ持ち上げる。素の bottom-10
      // (40px) は音声バー (64px) の内側に入ってボタンが裏に隠れる。
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
      style={{
        bottom:
          "calc(var(--audio-bar-h, 0px) + var(--consent-bar-h, 0px) + var(--event-bar-h, 0px) + 2.5rem)",
        zIndex: "var(--z-chat)",
      }}
      className={cn(
        "fixed right-6 size-12 rounded-full shadow-lg",
        "md:hidden",
        // 音声バーの出入りに合わせて滑らかに上下する。ChatBar / Cookie バーと
        // 同じ指定にして、3つの下端要素が同じ速さで動くようにする。
        "transition-[bottom,transform] duration-fast ease-enter",
        "hover:scale-105 active:scale-95",
      )}
    >
      <MessageCircle className="size-5" />
      {hasMessages && (
        <span
          data-slot="chat-launcher-indicator"
          className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-secondary border-2 border-background"
        />
      )}
    </Button>
  );
}
