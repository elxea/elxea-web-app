"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChat } from "@ai-sdk/react";
import {
  type UIMessage,
  type ChatStatus,
  type ChatTransport,
  type UIMessageChunk,
} from "ai";
import {
  ElxeaChatTransport,
  type ProductCardItem,
  type QuickReplyItem,
} from "./elxea-chat-transport";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatContextValue {
  /** Messages managed by Vercel AI SDK useChat */
  messages: UIMessage[];
  /** Whether the AI is currently streaming or submitted */
  status: ChatStatus;
  /** Whether the chat panel is expanded */
  isOpen: boolean;
  /** Toggle chat panel open/closed */
  setIsOpen: (open: boolean) => void;
  /** Current page pathname (for context) */
  pathname: string;
  /** Stable session ID (persisted in localStorage) */
  sessionId: string;
  /** Send a text message */
  sendMessage: (text: string) => void;
  /** Error state */
  error: Error | undefined;
  /** Product cards received from the agent (H-4) */
  productCards: ProductCardItem[];
  /** Quick reply suggestions received from the agent (H-4) */
  quickReplies: QuickReplyItem[];
  /** Clear quick replies after user selects one */
  clearQuickReplies: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ---------------------------------------------------------------------------
// Session ID helpers
// ---------------------------------------------------------------------------

const SESSION_KEY = "elxea-chat-session-id";

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(SESSION_KEY);
  // UUID v4 形式のみ有効（旧 sess_ プレフィックス付きは再生成）
  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
    return existing;
  }
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, id);
  return id;
}

// ---------------------------------------------------------------------------
// Mock transport (for development without backend)
// ---------------------------------------------------------------------------

const MOCK_RESPONSE =
  "elxea のお茶へのお問い合わせありがとうございます。現在準備中です。もう少々お待ちください。";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * When NEXT_PUBLIC_CHAT_MOCK=true, we bypass the real API and return a
 * simulated streaming response so the UI can be developed independently.
 */
class MockChatTransport implements ChatTransport<UIMessage> {
  async sendMessages(): Promise<ReadableStream<UIMessageChunk>> {
    const partId = crypto.randomUUID();

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        await delay(400);

        controller.enqueue({ type: "text-start", id: partId } as UIMessageChunk);

        for (const char of MOCK_RESPONSE) {
          controller.enqueue({
            type: "text-delta",
            id: partId,
            delta: char,
          } as UIMessageChunk);
          await delay(30);
        }

        controller.enqueue({ type: "text-end", id: partId } as UIMessageChunk);

        controller.close();
      },
    });
  }

  async resumeStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const CHAT_API_URL =
  process.env.NEXT_PUBLIC_CHAT_API_URL ?? "http://localhost:8787/api/chat";
const IS_MOCK = process.env.NEXT_PUBLIC_CHAT_MOCK === "true";

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [productCards, setProductCards] = useState<ProductCardItem[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReplyItem[]>([]);
  const initialisedRef = useRef(false);

  // Hydrate session ID on mount (client only)
  useEffect(() => {
    if (!initialisedRef.current) {
      setSessionId(getOrCreateSessionId());
      initialisedRef.current = true;
    }
  }, []);

  // sessionId を ref に保持（transport が最新値を参照できるよう）
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const transport = useMemo(() => {
    if (IS_MOCK) return new MockChatTransport();
    return new ElxeaChatTransport({
      api: CHAT_API_URL,
      getSessionId: () => sessionIdRef.current,
      callbacks: {
        onProductCards: (products) => setProductCards(products),
        onQuickReplies: (items) => setQuickReplies(items),
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { messages, sendMessage: rawSendMessage, status, error } =
    useChat({ transport });

  // 新しいメッセージ送信時にプロダクトカードとクイックリプライをクリア
  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || !sessionId) return;
      setIsOpen(true);
      setProductCards([]);
      setQuickReplies([]);
      rawSendMessage({ text });
    },
    [rawSendMessage, sessionId],
  );

  const clearQuickReplies = useCallback(() => {
    setQuickReplies([]);
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({
      messages,
      status,
      isOpen,
      setIsOpen,
      pathname,
      sessionId,
      sendMessage,
      error,
      productCards,
      quickReplies,
      clearQuickReplies,
    }),
    [messages, status, isOpen, pathname, sessionId, sendMessage, error, productCards, quickReplies, clearQuickReplies],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return ctx;
}
