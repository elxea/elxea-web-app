"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SendHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
// vaul Drawer removed — replaced with a plain fixed panel for iOS keyboard compatibility
import { cn } from "@/lib/utils";
import { useChatContext } from "./chat-provider";
import { ChatMessage } from "./chat-message";
import { ChatLauncher } from "./chat-launcher";
import { ProductCards } from "./product-card";
import { QuickReplies } from "./quick-replies";

// ---------------------------------------------------------------------------
// Placeholder logic
// ---------------------------------------------------------------------------

function getPlaceholder(pathname: string): string {
  const stripped = pathname.replace(/^\/(ja|en)/, "") || "/";

  if (stripped === "/" || stripped === "") {
    return "\u4eca\u65e5\u306f\u3069\u3093\u306a\u304a\u8336\u3092\u304a\u63a2\u3057\u3067\u3059\u304b\uff1f";
  }
  if (stripped.startsWith("/products")) {
    return "\u3053\u306e\u5546\u54c1\u306b\u3064\u3044\u3066\u8cea\u554f\u3042\u308a\u307e\u3059\u304b\uff1f";
  }
  if (stripped.startsWith("/faq")) {
    return "\u4ed6\u306b\u6c17\u306b\u306a\u308b\u3053\u3068\u306f\u3042\u308a\u307e\u3059\u304b\uff1f";
  }
  return "\u304a\u8336\u306b\u3064\u3044\u3066\u805e\u3044\u3066\u307f\u308b";
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
// Shared: Chat input form
// ---------------------------------------------------------------------------

interface ChatInputFormProps {
  input: string;
  setInput: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  placeholder: string;
  isStreaming: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
}

function ChatInputForm({
  input,
  setInput,
  onSubmit,
  onKeyDown,
  onFocus,
  placeholder,
  isStreaming,
  inputRef,
  className,
}: ChatInputFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className={cn("flex items-center gap-2", className)}
    >
      <input
        ref={inputRef}
        data-slot="chat-input"
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        placeholder={placeholder}
        aria-label="Chat message input"
        autoComplete="off"
        className={cn(
          // text-base (16px) on mobile prevents iOS Safari auto-zoom on focus;
          // md:text-sm restores 14px on desktop where zoom is not an issue.
          "flex-1 h-10 rounded-full border border-border/30 bg-background px-4 text-base md:text-sm shadow-sm",
          "placeholder:text-muted-foreground/50",
          "outline-none transition-colors",
          "focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/20",
        )}
      />
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        disabled={!input.trim() || isStreaming}
        aria-label="Send message"
        className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
      >
        <SendHorizontal className="size-4" />
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shared: Messages list
// ---------------------------------------------------------------------------

interface MessagesListProps {
  messages: ReturnType<typeof useChatContext>["messages"];
  isStreaming: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

function MessagesList({
  messages,
  isStreaming,
  messagesEndRef,
  className,
}: MessagesListProps) {
  const { productCards, quickReplies, sendMessage, clearQuickReplies } =
    useChatContext();

  const handleQuickReply = useCallback(
    (text: string) => {
      clearQuickReplies();
      sendMessage(text);
    },
    [clearQuickReplies, sendMessage],
  );

  return (
    <div
      data-slot="chat-messages"
      className={cn(
        "flex flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-4",
        className,
      )}
    >
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}
      {isStreaming &&
        messages.length > 0 &&
        messages[messages.length - 1]?.role === "user" && <TypingIndicator />}
      {/* H-4: Product cards */}
      {productCards.length > 0 && <ProductCards products={productCards} />}
      {/* H-4: Quick replies */}
      {quickReplies.length > 0 && (
        <QuickReplies
          items={quickReplies}
          onSelect={handleQuickReply}
          disabled={isStreaming}
        />
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop: Chat panel + inline input bar
// ---------------------------------------------------------------------------

function DesktopChatBar() {
  const { messages, status, isOpen, setIsOpen, pathname, sendMessage } =
    useChatContext();

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

  // Close panel on outside click (desktop only — skip on mobile to avoid
  // interfering with MobileChatDrawer which shares the same isOpen state)
  useEffect(() => {
    if (!isOpen) return;

    // Only register on desktop (md breakpoint = 768px)
    if (typeof window !== "undefined" && window.innerWidth < 768) return;

    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

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
      data-slot="chat-bar-desktop"
      className="fixed bottom-0 left-0 right-0 z-40 hidden md:block"
    >
      {/* Expanded chat panel */}
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
          <MessagesList
            messages={messages}
            isStreaming={isStreaming}
            messagesEndRef={messagesEndRef}
            className="max-h-[60vh]"
          />
        </div>
      )}

      {/* Input bar (always visible on desktop) */}
      <div
        data-slot="chat-input-bar"
        className="mx-auto w-full max-w-2xl px-4 pb-6 pt-3"
      >
        <ChatInputForm
          input={input}
          setInput={setInput}
          onSubmit={onSubmit}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (messages.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          isStreaming={isStreaming}
          inputRef={inputRef}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile: Drawer-based fullscreen chat
// ---------------------------------------------------------------------------

function MobileChatDrawer() {
  const { messages, status, isOpen, setIsOpen, pathname, sendMessage } =
    useChatContext();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isStreaming = status === "streaming" || status === "submitted";

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Do NOT auto-focus on mobile — let the user tap the input manually.
  // Auto-focus triggers the iOS keyboard immediately, which can cause
  // viewport issues before the panel animation completes.

  // Lock body scroll when panel is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
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
    <div data-slot="chat-bar-mobile" className="md:hidden">
      {/* Launcher button */}
      <ChatLauncher
        onClick={() => setIsOpen(true)}
        hasMessages={messages.length > 0}
      />

      {/* Fullscreen fixed panel — no vaul, no gesture detection, no viewport
          resize side-effects. Pure CSS positioning that iOS keyboards cannot
          displace. The panel slides up from the bottom via CSS transition. */}
      {isOpen && (
        <div
          data-slot="chat-panel-mobile"
          className={cn(
            "fixed inset-0 z-50 bg-background flex flex-col",
            "animate-in slide-in-from-bottom duration-300",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground tracking-wide">
              elxea assistant
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Messages area */}
          <MessagesList
            messages={messages}
            isStreaming={isStreaming}
            messagesEndRef={messagesEndRef}
            className="flex-1 min-h-0"
          />

          {/* Input bar — pb-safe accounts for iPhone home indicator.
              No dynamic keyboard-height tracking needed: with a normal
              fixed panel (not vaul), iOS Safari natively pushes the
              viewport up when the keyboard opens. */}
          <div
            data-slot="chat-input-bar-mobile"
            className="border-t border-border/40 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <ChatInputForm
              input={input}
              setInput={setInput}
              onSubmit={onSubmit}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              isStreaming={isStreaming}
              inputRef={inputRef}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatBar — renders both Desktop and Mobile variants
// ---------------------------------------------------------------------------

export function ChatBar() {
  return (
    <>
      <DesktopChatBar />
      <MobileChatDrawer />
    </>
  );
}
