"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SendHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatContext } from "./chat-provider";
import { ChatMessage } from "./chat-message";

// ---------------------------------------------------------------------------
// Placeholder logic
// ---------------------------------------------------------------------------

function getPlaceholder(pathname: string): string {
  // Strip locale prefix (e.g. /ja/products/foo -> /products/foo)
  const stripped = pathname.replace(/^\/(ja|en)/, "") || "/";

  if (stripped === "/" || stripped === "") {
    return "\u4eca\u65e5\u306f\u3069\u3093\u306a\u304a\u8336\u3092\u304a\u63a2\u3057\u3067\u3059\u304b\uff1f"; // 今日はどんなお茶をお探しですか？
  }
  if (stripped.startsWith("/products")) {
    return "\u3053\u306e\u5546\u54c1\u306b\u3064\u3044\u3066\u8cea\u554f\u3042\u308a\u307e\u3059\u304b\uff1f"; // この商品について質問ありますか？
  }
  if (stripped.startsWith("/faq")) {
    return "\u4ed6\u306b\u6c17\u306b\u306a\u308b\u3053\u3068\u306f\u3042\u308a\u307e\u3059\u304b\uff1f"; // 他に気になることはありますか？
  }
  return "\u304a\u8336\u306b\u3064\u3044\u3066\u805e\u3044\u3066\u307f\u308b"; // お茶について聞いてみる
}

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <div
      data-slot="typing-indicator"
      className="flex items-center gap-1.5 px-4 py-2.5"
    >
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatBar
// ---------------------------------------------------------------------------

export function ChatBar() {
  const {
    messages,
    status,
    isOpen,
    setIsOpen,
    pathname,
    sendMessage,
  } = useChatContext();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isStreaming = status === "streaming" || status === "submitted";

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Auto-open panel when messages arrive
  useEffect(() => {
    if (messages.length > 0 && !isOpen) {
      setIsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Close panel on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    // Delay binding so the current click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [isOpen, setIsOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isStreaming) return;
      sendMessage(input);
      setInput("");
    },
    [input, isStreaming, sendMessage],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!input.trim() || isStreaming) return;
        sendMessage(input);
        setInput("");
      }
    },
    [input, isStreaming, sendMessage],
  );

  const placeholder = getPlaceholder(pathname);

  return (
    <div
      ref={panelRef}
      data-slot="chat-bar"
      className="sticky bottom-0 z-40 w-full"
    >
      {/* ---- Expanded chat panel ---- */}
      {isOpen && messages.length > 0 && (
        <div
          data-slot="chat-panel"
          className={cn(
            "mx-auto w-full max-w-2xl",
            "border border-border/40 rounded-t-2xl",
            "bg-background/80 backdrop-blur-xl",
            "shadow-lg",
            "overflow-hidden",
            "transition-all duration-300",
          )}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground tracking-wide">
              elxea assistant
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setIsOpen(false)}
              aria-label="Close chat panel"
            >
              <X className="size-3.5" />
            </Button>
          </div>

          {/* Messages area */}
          <div
            data-slot="chat-messages"
            className="flex flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-4"
            style={{ maxHeight: "60vh" }}
          >
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isStreaming &&
              messages.length > 0 &&
              messages[messages.length - 1]?.role === "user" && (
                <TypingIndicator />
              )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* ---- Input bar (always visible) ---- */}
      <div
        data-slot="chat-input-bar"
        className={cn(
          "mx-auto w-full max-w-2xl",
          "px-4 py-3",
          "bg-background/80 backdrop-blur-xl",
          isOpen && messages.length > 0
            ? "border-x border-b border-border/40 rounded-b-2xl"
            : "border border-border/40 rounded-2xl shadow-lg",
        )}
      >
        <form
          onSubmit={onSubmit}
          className="flex items-center gap-2"
        >
          <input
            ref={inputRef}
            data-slot="chat-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (messages.length > 0) setIsOpen(true);
            }}
            placeholder={placeholder}
            aria-label="Chat message input"
            className={cn(
              "flex-1 h-10 rounded-full border border-border/60 bg-muted/40 px-4 text-sm",
              "placeholder:text-muted-foreground/70",
              "outline-none transition-colors",
              "focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20",
            )}
          />
          <Button
            type="submit"
            size="icon"
            variant="default"
            disabled={!input.trim() || isStreaming}
            aria-label="Send message"
            className="shrink-0 rounded-full"
          >
            <SendHorizontal className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
