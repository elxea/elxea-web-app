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
  /** LINE User ID from Auth.js session (null if not linked) */
  lineUserId: string | null;
  /** Get ISO timestamp for a message (from metadata or runtime map) */
  getMessageTimestamp: (messageId: string) => string | undefined;
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

// [SEC-B] チャット系はすべて自サーバ proxy (同一オリジン) 経由。
// proxy が X-API-Key + verify 済み customer_id を付けて cx-agent に転送する。
// 公開 Workers URL をブラウザから直叩きしない (なりすまし防止)。
const CHAT_PROXY_URL = "/api/chat";
const IS_MOCK = process.env.NEXT_PUBLIC_CHAT_MOCK === "true";

// ---------------------------------------------------------------------------
// History API types
// ---------------------------------------------------------------------------

/** Metadata attached to UIMessage for cross-channel display */
export interface ChatMessageMeta {
  channel?: "line" | "web";
  timestamp?: string; // ISO 8601
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
): Promise<HistoryApiResponse | null> {
  try {
    // [SEC-B] 自サーバ proxy 経由。customer_id はブラウザから送らず、proxy が
    // サーバの認証済みセッションから verify 済み customer_id を導出して cx-agent に渡す。
    const params = new URLSearchParams({ session_id: sessionId });
    const res = await fetch(
      `/api/chat/history?${params.toString()}`,
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
    metadata: {
      channel: m.channel,
      timestamp: m.created_at,
    } satisfies ChatMessageMeta,
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

/**
 * Fetch the LINE user ID from the Auth.js session API.
 * Returns null if not authenticated via LINE or on error.
 */
async function fetchLineUserId(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/session");
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user?.lineUserId ?? null;
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
  const [lineUserId, setLineUserId] = useState<string | null>(null);
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

  // Fetch LINE User ID from Auth.js session (once on mount)
  const lineUserIdFetchedRef = useRef(false);
  useEffect(() => {
    if (lineUserIdFetchedRef.current) return;
    lineUserIdFetchedRef.current = true;
    fetchLineUserId().then(setLineUserId);
  }, []);

  // sessionId / shopifyCustomerId / lineUserId を ref に保持（transport が最新値を参照できるよう）
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const shopifyCustomerIdRef = useRef(shopifyCustomerId);
  shopifyCustomerIdRef.current = shopifyCustomerId;
  const lineUserIdRef = useRef(lineUserId);
  lineUserIdRef.current = lineUserId;

  const transport = useMemo(() => {
    if (IS_MOCK) return new MockChatTransport();
    return new ElxeaChatTransport({
      api: CHAT_PROXY_URL,
      getSessionId: () => sessionIdRef.current,
      getShopifyCustomerId: () => shopifyCustomerIdRef.current,
      getLineUserId: () => lineUserIdRef.current,
      callbacks: {
        onProductCards: (products) => setProductCards(products),
        onQuickReplies: (items) => setQuickReplies(items),
      },
    });
  }, []);

  // Abort in-flight SSE request on unmount (I2: prevent leaked connections)
  useEffect(() => {
    const t = transport;
    return () => {
      if (t instanceof ElxeaChatTransport) {
        t.abort();
      }
    };
  }, [transport]);

  const { messages, sendMessage: rawSendMessage, status, error, setMessages } =
    useChat({ transport });

  // WC3: 初回マウント時にクロスチャネル会話履歴をロード
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    if (historyLoadedRef.current || !sessionId || IS_MOCK) return;
    historyLoadedRef.current = true;

    fetchChatHistory(sessionId).then((data) => {
      if (!data || data.messages.length === 0) return;
      // Only hydrate history if no messages have been sent yet (race condition guard)
      setMessages((prev) => {
        if (prev.length > 0) return prev;
        return historyToUIMessages(data.messages);
      });
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
      rawSendMessage({
        text,
        metadata: { timestamp: new Date().toISOString() } satisfies ChatMessageMeta,
      });
    },
    [rawSendMessage, sessionId],
  );

  const clearQuickReplies = useCallback(() => {
    setQuickReplies([]);
  }, []);

  // Runtime timestamp map: records when each message first appears (for
  // assistant messages created by the AI SDK which don't carry metadata.timestamp)
  const runtimeTimestampMapRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const map = runtimeTimestampMapRef.current;
    for (const msg of messages) {
      if (!map.has(msg.id)) {
        const meta = msg.metadata as ChatMessageMeta | undefined;
        map.set(msg.id, meta?.timestamp ?? new Date().toISOString());
      }
    }
  }, [messages]);

  const getMessageTimestamp = useCallback(
    (messageId: string): string | undefined => {
      return runtimeTimestampMapRef.current.get(messageId);
    },
    [],
  );

  const isAuthenticated = shopifyCustomerId !== null || lineUserId !== null;

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
      lineUserId,
      getMessageTimestamp,
    }),
    [messages, status, isOpen, pathname, sessionId, sendMessage, error, productCards, quickReplies, clearQuickReplies, isAuthenticated, lineUserId, getMessageTimestamp],
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
