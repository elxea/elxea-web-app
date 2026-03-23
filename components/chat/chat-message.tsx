"use client";

import { type UIMessage } from "ai";
import { cn } from "@/lib/utils";
import type { ChatMessageMeta } from "./chat-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the full text content from a UIMessage's parts array.
 */
function getTextFromMessage(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * Very lightweight Markdown-style link renderer.
 * Converts `[text](url)` into styled anchor tags.
 * Keeps the rest as plain text spans.
 */
function renderContent(text: string) {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>,
      );
    }
    parts.push(
      <a
        key={`l-${match.index}`}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 text-primary hover:text-primary/80 transition-colors"
      >
        {match[1]}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? parts : text;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChatMessageProps {
  message: UIMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const text = getTextFromMessage(message);
  const meta = message.metadata as ChatMessageMeta | undefined;
  const isLine = meta?.channel === "line";

  if (!text) return null;

  return (
    <div
      data-slot="chat-message"
      className={cn(
        "flex w-full flex-col",
        isUser ? "items-end" : "items-start",
      )}
    >
      {/* WC3: Cross-channel label for LINE messages */}
      {isLine && (
        <span className="mb-0.5 px-1 text-xs text-muted-foreground">
          LINE で送信
        </span>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {isUser ? text : renderContent(text)}
      </div>
    </div>
  );
}
