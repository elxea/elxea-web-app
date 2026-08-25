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
import { randomId } from "@/lib/random-id";

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
  const id = randomId();
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
    const partId = randomId();

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

// ---------------------------------------------------------------------------
// 履歴の持ち回り (監査 #6 / W-B)
// ---------------------------------------------------------------------------

/**
 * ## なぜ履歴をタブに置くのか
 *
 * 会話履歴は cx-agent への往復で、実測 1.6〜2.9 秒かかる (本番 / 2026-08-25)。
 * これがページを開くたびに 1 本ずつ出ていた。ChatProvider はレイアウトに居るので
 * 画面内の移動では再取得しないが、**リロード・新しいタブ・外から入り直すたびに
 * 毎回**払う。しかも履歴はチャットを開くまで一切見えない — 見えないもののために
 * 最初の描画と帯域を奪っていた。
 *
 * 変えたのは 2 点で、どちらも Web 側だけで完結する (cx-agent は触っていない)。
 *
 *   1. **同じタブの中では 1 回だけ引く** — `sessionStorage` に置いて使い回す。
 *      タブを閉じれば消えるので、共用端末に会話が残ることはない。
 *   2. **最初の描画に割り込ませない** — 画面が落ち着いてから (idle) 引く。
 *      ただしチャットを開かれたら待たずにその場で引く (開いたのに空、を作らない)。
 *
 * 保存先を `sessionStorage` にしたのは、`localStorage` だと閉じても残るため。
 * 鍵にログイン状態を混ぜているのは、ログイン前後で見えてよい履歴が変わるから。
 */
const HISTORY_CACHE_PREFIX = "elxea-chat-history:";

/** 履歴の作り置きの寿命。これを過ぎたら引き直す。 */
const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;

/** ログイン状態が変わったら別の作り置きとして扱う (他人の履歴を見せない)。 */
function historyCacheKey(sessionId: string): string {
  const signedIn =
    typeof document !== "undefined" && document.cookie.includes("shop_auth=1");
  return `${HISTORY_CACHE_PREFIX}${sessionId}:${signedIn ? "1" : "0"}`;
}

function readCachedHistory(sessionId: string): HistoryApiResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(historyCacheKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: HistoryApiResponse };
    if (!parsed?.data || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > HISTORY_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCachedHistory(sessionId: string, data: HistoryApiResponse): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      historyCacheKey(sessionId),
      JSON.stringify({ at: Date.now(), data }),
    );
  } catch {
    // 容量超過・プライベートモード等。作り置きが無いだけで機能は落ちない。
  }
}

/**
 * 発言したら作り置きを捨てる。
 *
 * 作り置きはサーバに保存済みの履歴の写しなので、こちらから 1 通送った時点で
 * 古くなる。次に開いたときに自分の発言が消えて見えるのを避けるため、送信のたびに
 * 捨てて引き直させる。
 */
function clearCachedHistory(sessionId: string): void {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    window.sessionStorage.removeItem(historyCacheKey(sessionId));
  } catch {
    // 消せなくても TTL で失効する。
  }
}

/** 画面が落ち着いてから走らせる。`requestIdleCallback` が無い環境では時間で代用。 */
function runWhenIdle(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const w = window as IdleWindow;

  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(fn, { timeout: 3000 });
    return () => w.cancelIdleCallback?.(handle);
  }
  const timer = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(timer);
}

/**
 * Convert history API messages to Vercel AI SDK UIMessage format.
 */
function historyToUIMessages(msgs: HistoryApiMessage[]): UIMessage[] {
  return msgs.map((m) => ({
    id: randomId(),
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
 * Resolve the LINE user ID.
 *
 * The Auth.js session endpoint (/api/auth/session) is not mounted in this app
 * (LINE linkage is handled via /api/line-login and /api/user/line-link), so the
 * previous fetch always 404'd and returned null while adding a console error on
 * every page load. We skip the call to the unimplemented endpoint; behaviour is
 * unchanged (still null) and the console noise is removed. If an Auth.js session
 * route is added later, restore the fetch here.
 */
async function fetchLineUserId(): Promise<string | null> {
  return null;
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

  /* WC3: クロスチャネル会話履歴のロード。
     引き方の方針 (作り置き優先 + 最初の描画に割り込ませない) は
     このファイル上部の「履歴の持ち回り」を参照。 */
  const historyLoadedRef = useRef(false);

  const hydrateHistory = useCallback(
    (data: HistoryApiResponse | null) => {
      if (!data || data.messages.length === 0) return;
      // Only hydrate history if no messages have been sent yet (race condition guard)
      setMessages((prev) => {
        if (prev.length > 0) return prev;
        return historyToUIMessages(data.messages);
      });
    },
    [setMessages],
  );

  /** 履歴を 1 回だけ引く。作り置きがあれば往復ゼロで済ませる。 */
  const loadHistory = useCallback(() => {
    if (historyLoadedRef.current || !sessionId || IS_MOCK) return;
    historyLoadedRef.current = true;

    const cached = readCachedHistory(sessionId);
    if (cached) {
      hydrateHistory(cached);
      return;
    }

    fetchChatHistory(sessionId).then((data) => {
      if (!data) {
        // 失敗は作り置きしない。次の機会に引き直せるよう鍵も戻す。
        historyLoadedRef.current = false;
        return;
      }
      writeCachedHistory(sessionId, data);
      hydrateHistory(data);
    });
  }, [sessionId, hydrateHistory]);

  /* 通常経路: 画面が落ち着いてから引く。最初の描画とは競合しない。 */
  useEffect(() => {
    if (!sessionId || IS_MOCK) return;
    return runWhenIdle(loadHistory);
  }, [sessionId, loadHistory]);

  /* チャットを開かれたら idle を待たずにその場で引く
     (開いたのに履歴が空、という状態を作らない)。 */
  useEffect(() => {
    if (!isOpen) return;
    loadHistory();
  }, [isOpen, loadHistory]);

  // 新しいメッセージ送信時にプロダクトカードとクイックリプライをクリア
  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || !sessionId) return;
      setIsOpen(true);
      setProductCards([]);
      setQuickReplies([]);
      /* 送った時点で作り置きは古い。捨てておかないと、次にこのタブで開いたときに
         自分の発言が抜けた履歴が出る。 */
      clearCachedHistory(sessionId);
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
