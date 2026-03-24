"use client";

import { type UIMessage } from "ai";
import { cn } from "@/lib/utils";
import { useCallback, useRef, useState } from "react";
import { useChatContext } from "./chat-provider";
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
// Feedback storage key
// ---------------------------------------------------------------------------

const FEEDBACK_STORAGE_KEY = "elxea-chat-feedback";

function getFeedbackStore(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(FEEDBACK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveFeedback(messageId: string, rating: number): void {
  if (typeof window === "undefined") return;
  try {
    const store = getFeedbackStore();
    store[messageId] = rating;
    sessionStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // sessionStorage full or disabled -- silently ignore
  }
}

function getExistingFeedback(messageId: string): number | null {
  const store = getFeedbackStore();
  return store[messageId] ?? null;
}

// ---------------------------------------------------------------------------
// Feedback API
// ---------------------------------------------------------------------------

const CHAT_API_URL = (
  process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://localhost:8787/api/chat"
).trim();
const CHAT_API_BASE = CHAT_API_URL.replace(/\/api\/chat\/?$/, "");

async function submitFeedback(
  sessionId: string,
  messageContent: string,
  rating: 1 | -1,
  comment?: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${CHAT_API_BASE}/api/chat/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        message_content: messageContent,
        rating,
        comment: comment || undefined,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// FeedbackButtons sub-component
// ---------------------------------------------------------------------------

function FeedbackButtons({
  messageId,
  messageContent,
}: {
  messageId: string;
  messageContent: string;
}) {
  const { sessionId } = useChatContext();
  const [selectedRating, setSelectedRating] = useState<number | null>(
    () => getExistingFeedback(messageId),
  );
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [commentSent, setCommentSent] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const handleFeedback = useCallback(
    async (rating: 1 | -1) => {
      if (selectedRating !== null) return;
      setSelectedRating(rating);
      saveFeedback(messageId, rating);

      if (rating === -1) {
        setShowComment(true);
        // Focus the textarea on next render
        setTimeout(() => commentRef.current?.focus(), 50);
      }

      await submitFeedback(sessionId, messageContent, rating);
    },
    [sessionId, messageContent, messageId, selectedRating],
  );

  const handleCommentSubmit = useCallback(async () => {
    if (!comment.trim() || commentSent) return;
    setCommentSent(true);
    await submitFeedback(sessionId, messageContent, -1, comment.trim());
    setShowComment(false);
  }, [sessionId, messageContent, comment, commentSent]);

  return (
    <div className="flex flex-col items-start gap-1 mt-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={selectedRating !== null}
          onClick={() => handleFeedback(1)}
          className={cn(
            "px-1.5 py-0.5 rounded text-xs transition-colors",
            selectedRating === 1
              ? "text-primary bg-primary/10"
              : selectedRating !== null
                ? "text-muted-foreground/40 cursor-not-allowed"
                : "text-muted-foreground hover:text-primary hover:bg-primary/5",
          )}
          aria-label="Good response"
        >
          {"\uD83D\uDC4D"}
        </button>
        <button
          type="button"
          disabled={selectedRating !== null}
          onClick={() => handleFeedback(-1)}
          className={cn(
            "px-1.5 py-0.5 rounded text-xs transition-colors",
            selectedRating === -1
              ? "text-destructive bg-destructive/10"
              : selectedRating !== null
                ? "text-muted-foreground/40 cursor-not-allowed"
                : "text-muted-foreground hover:text-destructive hover:bg-destructive/5",
          )}
          aria-label="Bad response"
        >
          {"\uD83D\uDC4E"}
        </button>
        {selectedRating !== null && !showComment && (
          <span className="text-xs text-muted-foreground/60 ml-1">
            {selectedRating === 1 ? "Thanks!" : "Thank you"}
          </span>
        )}
      </div>
      {showComment && !commentSent && (
        <div className="flex flex-col gap-1 w-full max-w-[80%]">
          <textarea
            ref={commentRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="How can we improve? (optional)"
            rows={2}
            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={handleCommentSubmit}
              className="px-2 py-0.5 rounded text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => {
                setShowComment(false);
                setCommentSent(true);
              }}
              className="px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timestamp formatter
// ---------------------------------------------------------------------------

/**
 * Format an ISO timestamp to HH:MM (24-hour) in the user's local timezone.
 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChatMessageProps {
  message: UIMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { getMessageTimestamp } = useChatContext();
  const isUser = message.role === "user";
  const text = getTextFromMessage(message);
  const meta = message.metadata as ChatMessageMeta | undefined;
  const isLine = meta?.channel === "line";

  const timestamp = meta?.timestamp ?? getMessageTimestamp(message.id);
  const timeLabel = timestamp ? formatTime(timestamp) : "";

  if (!text) return null;

  return (
    <div
      data-slot="chat-message"
      className={cn(
        "flex w-full flex-col",
        isUser ? "items-end" : "items-start",
      )}
    >
      {/* WC3: Cross-channel label + timestamp row for LINE messages (user side) */}
      {isLine && isUser && (
        <div className="mb-0.5 flex items-center gap-1.5 px-1">
          <span className="text-xs text-muted-foreground">LINE</span>
        </div>
      )}
      {/* Bubble + timestamp row */}
      <div
        className={cn(
          "flex items-end gap-1.5",
          isUser ? "flex-row-reverse" : "flex-row",
        )}
      >
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
        {/* Timestamp + channel label */}
        <div className={cn(
          "flex shrink-0 items-end gap-1 pb-0.5",
          isUser ? "flex-row-reverse" : "flex-row",
        )}>
          {/* LINE label for assistant messages */}
          {isLine && !isUser && (
            <span className="text-[10px] text-muted-foreground">LINE</span>
          )}
          {timeLabel && (
            <span className="text-[10px] text-muted-foreground leading-none">
              {timeLabel}
            </span>
          )}
        </div>
      </div>
      {/* Feedback buttons for assistant messages */}
      {!isUser && (
        <FeedbackButtons messageId={message.id} messageContent={text} />
      )}
    </div>
  );
}
