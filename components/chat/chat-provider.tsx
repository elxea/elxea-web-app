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
  /** Whether the user is authenticated via Shopify */
  isAuthenticated: boolean;
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
const CHAT_API_BASE = CHAT_API_URL.replace(/\/api\/chat$/, "");
const IS_MOCK = process.env.NEXT_PUBLIC_CHAT_MOCK === "true";

// ---------------------------------------------------------------------------
// History API types
// ---------------------------------------------------------------------------

/** Metadata attached to UIMessage for cross-channel display */
export interface ChatMessageMeta {
  channel?: "line" | "web";
}

interface HistoryApiMessage {
  role: "user" | "assistant";
  content: string;
  channel: "line" | "web";
  created_at: string;
  product_cards?: ProductCardItem[];
}

interface HistoryApiResponse {
  messages: HistoryApiMessage[];
  is_linked: boolean;
}

/**
 * Fetch conversation history from the cx-agent API.
 * Returns null on error so the chat can degrade gracefully.
 */
async function fetchChatHistory(
  sessionId: string,
  shopifyCustomerId: string | null,
): Promise<HistoryApiResponse | null> {
  try {
    const params = new URLSearchParams({ session_id: sessionId });
    if (shopifyCustomerId) {
      params.set("shopify_customer_id", shopifyCustomerId);
    }
    const res = await fetch(
      `${CHAT_API_BASE}/api/chat/history?${params.toString()}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as HistoryApiResponse;
  } catch {
    return null;
  }
}

/**
 * Convert history API messages to Vercel AI SDK UIMessage format.
 */
function historyToUIMessages(msgs: HistoryApiMessage[]): UIMessage[] {
  return msgs.map((m) => ({
    id: crypto.randomUUID(),
    role: m.role,
    parts: [{ type: "text" as const, text: m.content }],
    metadata: { channel: m.channel } satisfies ChatMessageMeta,
  }));
}

/**
 * Fetch the Shopify Customer ID from the server-side session.
 * Returns null if not authenticated or on error.
 */
async function fetchShopifyCustomerId(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/customer-id");
    if (!res.ok) return null;
    const data = await res.json();
    return data.customer_id ?? null;
  } catch {
    return null;
  }
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [shopifyCustomerId, setShopifyCustomerId] = useState<string | null>(
    null,
  );
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

  // Fetch Shopify Customer ID if shop_auth cookie exists (non-httpOnly flag).
  // Re-check when pathname changes (user might log in/out during navigation).
  useEffect(() => {
    const hasAuthFlag =
      typeof document !== "undefined" &&
      document.cookie.includes("shop_auth=1");

    if (hasAuthFlag && !shopifyCustomerId) {
      fetchShopifyCustomerId().then(setShopifyCustomerId);
    } else if (!hasAuthFlag && shopifyCustomerId) {
      // User logged out
      setShopifyCustomerId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // sessionId / shopifyCustomerId を ref に保持（transport が最新値を参照できるよう）
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const shopifyCustomerIdRef = useRef(shopifyCustomerId);
  shopifyCustomerIdRef.current = shopifyCustomerId;

  const transport = useMemo(() => {
    if (IS_MOCK) return new MockChatTransport();
    return new ElxeaChatTransport({
      api: CHAT_API_URL,
      getSessionId: () => sessionIdRef.current,
      getShopifyCustomerId: () => shopifyCustomerIdRef.current,
      callbacks: {
        onProductCards: (products) => setProductCards(products),
        onQuickReplies: (items) => setQuickReplies(items),
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { messages, sendMessage: rawSendMessage, status, error, setMessages } =
    useChat({ transport });

  // WC3: 初回マウント時にクロスチャネル会話履歴をロード
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    if (historyLoadedRef.current || !sessionId || IS_MOCK) return;
    historyLoadedRef.current = true;

    fetchChatHistory(sessionId, shopifyCustomerId).then((data) => {
      if (!data || data.messages.length === 0) return;
      setMessages(historyToUIMessages(data.messages));
    });
    // 初回のみ実行。shopifyCustomerId の変化で再取得はしない
    // （認証後のリロードは別フローで対応）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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

  const isAuthenticated = shopifyCustomerId !== null;

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
      isAuthenticated,
    }),
    [messages, status, isOpen, pathname, sessionId, sendMessage, error, productCards, quickReplies, clearQuickReplies, isAuthenticated],
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
