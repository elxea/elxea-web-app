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
 *  - `--bottom-obstruction` is published by whichever bottom-fixed element is
 *    currently on screen (today: the cookie banner, which sits at z-50 and
 *    would otherwise completely bury this z-40 button on first visit — and on
 *    desktop this button is now the *only* way into chat). Defaulting to 0px
 *    leaves the normal case untouched.
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
      className={cn(
        "fixed right-4 z-40 size-12 rounded-full shadow-lg",
        "bottom-[calc(var(--bottom-obstruction,0px)+1.25rem+env(safe-area-inset-bottom,0px))]",
        // Desktop: labelled pill, slightly further from the viewport edges.
        "md:right-6 md:h-12 md:w-auto md:px-5",
        "md:bottom-[calc(var(--bottom-obstruction,0px)+1.5rem)]",
        "transition-transform duration-200",
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
