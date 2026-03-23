"use client";

import { cn } from "@/lib/utils";
import { useChatContext } from "./chat-provider";

// ---------------------------------------------------------------------------
// LINE 友だち追加 CTA
//
// チャットパネル展開時に表示する控えめな導線バナー。
// - 未ログイン: 「ログインすると LINE でも会話を続けられます」
// - ログイン済み: LINE 友だち追加リンク
// ---------------------------------------------------------------------------

const LINE_FRIEND_URL = process.env.NEXT_PUBLIC_LINE_FRIEND_URL;

/**
 * LINE icon (simplified official logo shape).
 * Using an inline SVG to avoid external asset dependency.
 */
function LineIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 2C6.48 2 2 5.88 2 10.54c0 4.07 3.61 7.47 8.49 8.22.33.07.78.22.89.5.1.25.07.65.03.91l-.14.85c-.04.25-.2.99.87.54s5.84-3.44 7.97-5.9C21.85 13.66 22 12.14 22 10.54 22 5.88 17.52 2 12 2zm-3.41 11.12H6.53a.52.52 0 01-.52-.52V8.3c0-.29.23-.52.52-.52s.52.23.52.52v3.78h1.54c.29 0 .52.23.52.52s-.23.52-.52.52zm1.82-.52a.52.52 0 01-1.04 0V8.3a.52.52 0 011.04 0v4.3zm4.14 0a.52.52 0 01-.34.49.52.52 0 01-.57-.12l-2.12-2.88v2.51a.52.52 0 01-1.04 0V8.3a.52.52 0 01.34-.49.52.52 0 01.57.12l2.12 2.88V8.3a.52.52 0 011.04 0v4.3zm3.08-2.74a.52.52 0 010 1.04h-1.54v.66h1.54a.52.52 0 010 1.04h-2.06a.52.52 0 01-.52-.52V8.3c0-.29.23-.52.52-.52h2.06a.52.52 0 010 1.04h-1.54v.52h1.54z" />
    </svg>
  );
}

export function LineCta() {
  const { isAuthenticated, messages } = useChatContext();

  // Only show after at least 1 exchange (not on empty chat)
  if (messages.length < 2) return null;

  // If LINE_FRIEND_URL is not configured, don't render
  if (!LINE_FRIEND_URL && isAuthenticated) return null;

  if (!isAuthenticated) {
    // Unauthenticated: gentle suggestion to log in
    return (
      <div
        data-slot="line-cta"
        className={cn(
          "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5",
          "bg-muted/50 border border-border/30",
          "text-xs text-muted-foreground leading-relaxed",
        )}
      >
        <LineIcon className="size-4 shrink-0 text-[#06C755]" />
        <span>
          ログインすると、LINE でもこの会話を続けられます
        </span>
      </div>
    );
  }

  if (!LINE_FRIEND_URL) return null;

  // Authenticated: show LINE friend add link
  return (
    <a
      data-slot="line-cta"
      href={LINE_FRIEND_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5",
        "bg-muted/50 border border-border/30",
        "text-xs text-muted-foreground leading-relaxed",
        "hover:border-[#06C755]/30 hover:bg-[#06C755]/5 transition-colors",
        "no-underline",
      )}
    >
      <LineIcon className="size-4 shrink-0 text-[#06C755]" />
      <span>
        LINE でも会話を続けられます。
        <span className="font-medium text-foreground ml-0.5">
          友だち追加
        </span>
      </span>
    </a>
  );
}
