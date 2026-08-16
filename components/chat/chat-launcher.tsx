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
      // 音声バーの高さぶん持ち上げる。素の bottom-10 (40px) はバー (64px) の
      // 内側に入ってしまい、ボタンがバーの裏に隠れる。
      style={{ bottom: "calc(var(--audio-bar-h, 0px) + 2.5rem)" }}
      className={cn(
        "fixed right-6 z-40 size-12 rounded-full shadow-lg",
        "md:hidden",
        // 音声バーの出入りに合わせて滑らかに上下する。ChatBar / Cookie バーと
        // 同じ指定にして、3つの下端要素が同じ速さで動くようにする。
        "transition-[bottom,transform] duration-normal ease-enter",
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
