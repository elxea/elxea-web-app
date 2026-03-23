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
      className={cn(
        "fixed bottom-10 right-6 z-40 size-12 rounded-full shadow-lg",
        "md:hidden",
        "transition-transform duration-200",
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
