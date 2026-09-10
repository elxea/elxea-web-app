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
import {
  authSignatureFromCookie,
  clearAllHistoryCache,
  hasLineAuthFromCookie,
  historyCacheKey,
  isSignedInFromCookie,
  isSignedInForChat,
  readCachedHistory,
  writeCachedHistory,
  type HistoryIdentity,
} from "@/lib/chat/history-cache";
import { applyAuthTransition } from "@/lib/chat/auth-transition";
import { env } from "@/lib/config";

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
  /** サーバが発行した会話 ID (`/api/chat/session`)。解決するまでは空文字。 */
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

/**
 * 会話 ID をサーバから受け取る。
 *
 * ## なぜ自分で作らないのか (localStorage の自作 UUID をやめた理由)
 *
 * 以前はここが `localStorage` に v4 UUID を作って持ち、それを body に載せて
 * 送っていた。サーバは形も出所も見ないので、**他人の会話 ID を送るだけで**
 * その会話を読む・書く・自分の LINE に恒久的に結び付けることができた。
 * UUID は秘密ではない (URL・ログ・共用端末・総当たり) ので、「知っていること」を
 * 所有権の根拠にできない。経緯は `lib/chat/session-token.ts` の冒頭。
 *
 * いまは `/api/chat/session` が httpOnly の署名付き cookie を発行し、画面はその
 * ID を**表示と作り置きの鍵のためだけ**に受け取る。署名はブラウザに渡らない。
 *
 * @param rotate ログイン状態が変わったとき (端末の前の人が入れ替わりうるとき) に
 *   必ず振り直す。共用端末で前の人の会話が続くのを断ち切る。
 */
async function fetchServerSessionId(rotate = false): Promise<string> {
  try {
    const res = await fetch(
      rotate ? "/api/chat/session?rotate=1" : "/api/chat/session",
      { credentials: "same-origin" },
    );
    if (res.ok) {
      const data = (await res.json()) as { session_id?: unknown };
      if (typeof data.session_id === "string" && data.session_id) {
        return data.session_id;
      }
    }
  } catch {
    /* 取れなかったときの落とし方は下のフォールバックに一本化してある
       (ここで握り潰しているのではなく、失敗も成功も同じ出口を通す)。 */
  }

  /* 取れなくてもチャットは死なせない。サーバは cookie 側の会話 ID を使うので、
     この場しのぎの ID で会話が壊れることはない — 画面に履歴が出ないだけで、
     発言そのものは正しい会話に入る。 */
  return randomId();
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
const IS_MOCK = env("NEXT_PUBLIC_CHAT_MOCK") === "true";

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
async function fetchChatHistory(): Promise<HistoryApiResponse | null> {
  try {
    /* [SEC-B] 自サーバ proxy 経由。customer_id はブラウザから送らず、proxy が
       サーバの認証済みセッションから verify 済み customer_id を導出して cx-agent に渡す。
       [SEC-C] `session_id` も送らない。proxy は署名付き cookie から会話 ID を決める
       ので、ここで積んでも無視される (積むと「指定できる」と読めてしまい危ない)。 */
    const res = await fetch("/api/chat/history");
    if (!res.ok) return null;
    return (await res.json()) as HistoryApiResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 履歴の持ち回り (監査 #6 / W-B)
// ---------------------------------------------------------------------------

/* 鍵の作り方・読み書き・全消しは `lib/chat/history-cache.ts` が正本。
   共用端末での取り違え (QA 指摘 2026-08-26) の経緯もそちらのヘッダに書いてある。 */

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
  /* 履歴を引いたか。ログイン状態が変わったら false に戻して引き直させる。 */
  const historyLoadedRef = useRef(false);
  /* 画面上のメッセージを空にする手段。`useChat` はこの下で作られるので、
     上の効果からも呼べるように ref 越しに繋ぐ。 */
  const resetMessagesRef = useRef<(() => void) | null>(null);
  /* LINE ユーザー ID を引いたか。人が入れ替わったら false に戻して引き直させる
     (前の人の ID が作り置きの鍵に残らないように)。 */
  const lineUserIdFetchedRef = useRef(false);

  /* 会話 ID をサーバから取る (client only)。往復 1 回なので、届くまで `sessionId`
     は空のまま — その間は送信も履歴取得も止まる (`!sessionId` で弾いている)。 */
  useEffect(() => {
    if (initialisedRef.current) return;
    initialisedRef.current = true;

    let cancelled = false;
    fetchServerSessionId().then((id) => {
      if (!cancelled) setSessionId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ログイン状態。cookie 名を完全一致で見る (部分一致だと `xshop_auth=1` のような
     別名でも真になる)。判定は `lib/chat/history-cache.ts` に置いてテストしてある。 */
  const [signedIn, setSignedIn] = useState(false);

  /* LINE の旗。Shopify の旗が立っていなくても真になりうる (LINE だけで入った人)。
     作り置きの鍵を匿名の人と共有させないために持つ。 */
  const [lineAuthed, setLineAuthed] = useState(false);

  /* 直前の**入口の署名** (`""` / `"s"` / `"l"` / `"sl"`)。入れ替わりを見るためだけに
     持つ。初回は「まだ何とも比べていない」を意味する null (初回訪問をログアウトと
     誤認しないため)。
     以前はここが「Shopify にログイン中か」の真偽値で、LINE だけで入った人は
     ログイン・ログアウトのどちらでも値が動かず入れ替わりを取り逃していた
     (QA 指摘 2026-08-25)。 */
  const prevAuthSignatureRef = useRef<string | null>(null);

  // Fetch Shopify Customer ID if shop_auth cookie exists (non-httpOnly flag).
  // Re-check when pathname changes (user might log in/out during navigation).
  useEffect(() => {
    const cookie = typeof document !== "undefined" ? document.cookie : "";
    const hasAuthFlag = isSignedInFromCookie(cookie);

    setSignedIn(hasAuthFlag);
    setLineAuthed(hasLineAuthFromCookie(cookie));

    /* ## 人が入れ替わったら、タブに残っているものを断ち切る (QA 指摘 2026-08-26)
     *
     * ログアウトはサーバの cookie を消すだけで、`localStorage` の会話 ID と
     * `sessionStorage` の作り置きには触れない。共用端末で A がログアウトし、
     * 5 分以内に B が同じタブでログインすると、会話 ID が据え置きでログイン中
     * フラグも "1" に戻るため鍵が一致し、**B に A の履歴が出る**。
     *
     * そこでログイン状態が変わった時点で、作り置きを全消しし、会話 ID を振り直し、
     * 画面上のメッセージも捨てる。TTL の残りに依存しない止め方なので、鍵の指紋に
     * よる分離と二重に効かせている。 */
    const signature = authSignatureFromCookie(cookie);
    const previous = prevAuthSignatureRef.current;
    prevAuthSignatureRef.current = signature;

    /* 判断と後始末の中身は `lib/chat/auth-transition.ts` が正本 (テストで縛って
       ある)。ここは「何を消すか」の配線だけを持つ。 */
    if (
      typeof window !== "undefined" &&
      applyAuthTransition(previous, signature, {
        clearCache: () => clearAllHistoryCache(window.sessionStorage),
        /* 振り直しはサーバに頼む (cookie ごと差し替える)。往復 1 回かかるので、
           先に空へ落として**古い ID が生きたまま使われる隙間**を作らない。 */
        rotateSession: () => {
          setSessionId("");
          void fetchServerSessionId(true).then(setSessionId);
        },
        forgetIdentity: () => {
          setShopifyCustomerId(null);
          setLineUserId(null);
          lineUserIdFetchedRef.current = false;
        },
        resetMessages: () => {
          historyLoadedRef.current = false;
          resetMessagesRef.current?.();
        },
      })
    ) {
      return;
    }

    if (hasAuthFlag && !shopifyCustomerId) {
      fetchShopifyCustomerId().then(setShopifyCustomerId);
    } else if (!hasAuthFlag && shopifyCustomerId) {
      // User logged out
      setShopifyCustomerId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Fetch LINE User ID from Auth.js session (once on mount)
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

  /* 上のログイン状態の効果から画面上のメッセージを捨てられるようにする
     (人が入れ替わったときに前の人の発言を残さない)。 */
  resetMessagesRef.current = () => setMessages([]);

  /* WC3: クロスチャネル会話履歴のロード。
     引き方の方針 (作り置き優先 + 最初の描画に割り込ませない) は
     このファイル上部の「履歴の持ち回り」を参照。 */
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

  /* 作り置きの鍵になる identity。**ログイン中なのに顧客 ID がまだ解決していない
     間は引かない** — 解決前に引くと「ログイン中・本人不明」の鍵で読み書きしてしまい、
     人が変わっても同じ鍵に当たりうるため。未ログインなら顧客 ID は無くて当たり前
     なので、そのまま進む。 */
  const identity: HistoryIdentity | null =
    !sessionId || (signedIn && !shopifyCustomerId)
      ? null
      : {
          sessionId,
          signedIn,
          customerId: shopifyCustomerId,
          /* LINE だけで入った人を匿名の人と同じ棚に入れない (QA 指摘 2026-08-25)。
             ここで足止めはしない — LINE の人は Shopify 顧客 ID を持たないので
             「解決を待つ」作りにすると履歴が永久に出なくなる。鍵を分けるだけ。 */
          lineAuthed,
          lineUserId,
        };

  /** 履歴を 1 回だけ引く。作り置きがあれば往復ゼロで済ませる。 */
  const loadHistory = useCallback(() => {
    if (historyLoadedRef.current || !identity || IS_MOCK) return;
    historyLoadedRef.current = true;

    const cached = readCachedHistory<HistoryApiResponse>(
      window.sessionStorage,
      identity,
    );
    if (cached) {
      hydrateHistory(cached);
      return;
    }

    fetchChatHistory().then((data) => {
      if (!data) {
        // 失敗は作り置きしない。次の機会に引き直せるよう鍵も戻す。
        historyLoadedRef.current = false;
        return;
      }
      writeCachedHistory(window.sessionStorage, identity, data);
      hydrateHistory(data);
    });
    // identity は 3 つの値から毎描画作り直すので、鍵の文字列で同一性を見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity && historyCacheKey(identity), hydrateHistory]);

  /* 通常経路: 画面が落ち着いてから引く。最初の描画とは競合しない。 */
  useEffect(() => {
    if (!identity || IS_MOCK) return;
    return runWhenIdle(loadHistory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity && historyCacheKey(identity), loadHistory]);

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
         自分の発言が抜けた履歴が出る。鍵は identity ごとに分かれているので全消しする
         (自分の分だけ狙って消すより、取りこぼしが無い)。 */
      if (typeof window !== "undefined") clearAllHistoryCache(window.sessionStorage);
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

  /* ログイン済みか (画面の見せ方だけに使う旗)。判断の中身と理由は
     `lib/chat/history-cache.ts` の `isSignedInForChat` が正本 (テストで縛ってある)。
     ここは配線だけを持つ。 */
  const isAuthenticated = isSignedInForChat({ shopifyCustomerId, lineAuthed });

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
