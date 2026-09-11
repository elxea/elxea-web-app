/**
 * Hume EVI との接続・設定送信・イベント分解・(限度付きの) 再接続。
 *
 * ## この層が持たない方針
 *
 * 「押して話す」か「常時聞く」か (設計書 U-1) は未決なので、この層は
 * `connect()` / `close()` の明示 API だけを持ち、いつ繋ぐかを知らない。
 * 入場券 (access token) も EVI の config ID も **引数で受け取る**。
 * 入場券の取得は `app/api/voice/token/route.ts` の担当で、この層は取りに行かない。
 *
 * ## 音声フォーマット (確定済みの事実)
 *
 * 接続直後に送る設定のフィールド名は **`encoding`**。公式ガイド本文にある `format`
 * は誤りで、仕様書のほうが正しい。ここを間違えると設定が黙って無視され、送った音が
 * 丸ごと無音として扱われる (エラーにならないので気づけない)。
 *
 * ## 再接続について
 *
 * Hume は **無音で繋いでいるだけでも課金される** (60 秒の無音が 60.99 秒として記録
 * された実測あり)。よって自動再接続は無条件ループにしない:
 * - 回数の上限を必ず持つ (既定 2 回)
 * - 呼び出し側が閉じたとき・正常終了・認証失敗では一切再接続しない
 * - `reconnect: false` で完全に切れる
 */

/**
 * `WebSocket` のうちこの層が使う部分だけの形。テストでモックを差し込むために
 * 本物の `WebSocket` 型に依存しない。
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string; wasClean?: boolean }) => void) | null;
}

export const HUME_EVI_URL = "wss://api.hume.ai/v0/evi/chat";

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  maxAttempts: 2,
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

export type ReconnectPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type HumeSocketState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closing"
  | "closed";

/** Hume から届く「利用者がこう言った」。48 感情のスコアを含む。 */
export type HumeUserMessage = {
  type: "user_message";
  message?: { role?: string; content?: string };
  /**
   * 感情の推定値。`models.prosody.scores` に 48 個の感情名 → スコアが入る。
   * **加工せずそのまま外へ出す** (日本語で返ることは実機確認済み)。
   */
  models?: { prosody?: { scores?: Record<string, number> } };
  [key: string]: unknown;
};

export type HumeAssistantMessage = {
  type: "assistant_message";
  message?: { role?: string; content?: string };
  [key: string]: unknown;
};

export type HumeSocketHandlers = {
  onStateChange?: (state: HumeSocketState) => void;
  onOpen?: () => void;
  onUserMessage?: (message: HumeUserMessage) => void;
  onAssistantMessage?: (message: HumeAssistantMessage) => void;
  /** 返事の音声チャンク (Hume が返す容器付きデータをそのまま渡す)。 */
  onAudioChunk?: (chunk: ArrayBuffer) => void;
  /** 利用者が割り込んだ。再生中の返事は捨てる。 */
  onUserInterruption?: () => void;
  /** 1 回の返事の音声が出し切られた。 */
  onAssistantEnd?: () => void;
  /** 分解できなかったものも含め、その他のイベントを素通しする。 */
  onMessage?: (message: Record<string, unknown>) => void;
  onError?: (error: { source: "hume" | "socket" | "parse"; detail: unknown }) => void;
  onClose?: (event: { code?: number; reason?: string; willReconnect: boolean }) => void;
};

export type HumeSocketOptions = {
  /** 短い期限の入場券。取得は別担当 (`app/api/voice/token/route.ts`)。 */
  accessToken: string;
  /** EVI の config ID。設定ファイルからは読まない。 */
  configId: string;
  /**
   * 会話をまたいで同じ会話として扱うための文字列。サーバが決めた意味のない値
   * だけを渡すこと (生の顧客 ID・会話 ID を渡さない)。
   */
  sessionId?: string;
  /** 既定 16000。`lib/voice/mic-stream.ts` の送出値と必ず揃えること。 */
  sampleRate?: number;
  /** 既定 1 (モノラル)。 */
  channels?: number;
  /** 既定 `wss://api.hume.ai/v0/evi/chat`。 */
  baseUrl?: string;
  /** 既定は上限 2 回の指数バックオフ。`false` で自動再接続を完全に切る。 */
  reconnect?: ReconnectPolicy | false;
  /**
   * 繋ぎっぱなしの上限 (ms)。超えたら自分から閉じる。無音でも課金されるので、
   * 呼び出し側が費用の上限を決めたいときに渡す。未指定なら働かない。
   */
  maxSessionMs?: number;
  /** テスト用の差し込み口。既定はブラウザの `WebSocket`。 */
  webSocketFactory?: (url: string) => WebSocketLike;
  handlers?: HumeSocketHandlers;
};

export type HumeSocket = {
  connect: () => void;
  /** 16kHz・モノラル・16bit のフレームを送る。開いていなければ捨てる。 */
  sendAudio: (frame: ArrayBuffer) => void;
  /** 任意のメッセージを送る (割り込み指示など)。 */
  send: (message: Record<string, unknown>) => void;
  /** 呼び出し側からの終了。以後は再接続しない。 */
  close: (code?: number, reason?: string) => void;
  readonly state: HumeSocketState;
};

const OPEN = 1;

/** 再接続しても直らない終了コード。ここで粘ると課金だけが増える。 */
const NON_RETRYABLE_CLOSE_CODES = new Set([
  1000, // 正常終了
  1008, // ポリシー違反 (入場券の不備を含む)
  3000, // 認証失敗
  4001,
  4003,
]);

export function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // 一度に渡すと引数の数が多すぎて落ちるので刻む。
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function createHumeSocket(options: HumeSocketOptions): HumeSocket {
  const {
    accessToken,
    configId,
    sessionId,
    sampleRate = 16000,
    channels = 1,
    baseUrl = HUME_EVI_URL,
    reconnect = DEFAULT_RECONNECT_POLICY,
    maxSessionMs,
    webSocketFactory,
    handlers = {},
  } = options;

  let socket: WebSocketLike | null = null;
  let state: HumeSocketState = "idle";
  let attempts = 0;
  let closedByCaller = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionTimer: ReturnType<typeof setTimeout> | null = null;

  function setState(next: HumeSocketState): void {
    if (state === next) return;
    state = next;
    handlers.onStateChange?.(next);
  }

  function buildUrl(): string {
    const url = new URL(baseUrl);
    // 入場券はクエリで渡す (Hume の仕様)。ブラウザの WebSocket は任意のヘッダを
    // 付けられないため、この経路以外に選択肢が無い。
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("config_id", configId);
    return url.toString();
  }

  /**
   * 接続直後に送る設定。フィールド名は `format` ではなく **`encoding`**。
   * 申告値と実際に送る音がずれると丸ごと無音として扱われる。
   */
  function sendSessionSettings(): void {
    const settings: Record<string, unknown> = {
      type: "session_settings",
      audio: {
        encoding: "linear16",
        sample_rate: sampleRate,
        channels,
      },
    };
    if (sessionId) settings.custom_session_id = sessionId;
    socket?.send(JSON.stringify(settings));
  }

  function clearTimers(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sessionTimer) clearTimeout(sessionTimer);
    reconnectTimer = null;
    sessionTimer = null;
  }

  function dispatch(raw: unknown): void {
    if (typeof raw !== "string") return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      handlers.onError?.({ source: "parse", detail: error });
      return;
    }

    handlers.onMessage?.(parsed);

    switch (parsed.type) {
      case "user_message":
        // 48 感情のスコアを含むメッセージをそのまま素通しする。中身を間引くと
        // 「どう感じていたか」を使う側の選択肢を先に潰してしまう。
        handlers.onUserMessage?.(parsed as HumeUserMessage);
        return;
      case "assistant_message":
        handlers.onAssistantMessage?.(parsed as HumeAssistantMessage);
        return;
      case "audio_output": {
        const data = parsed.data;
        if (typeof data !== "string") return;
        try {
          handlers.onAudioChunk?.(decodeBase64(data));
        } catch (error) {
          handlers.onError?.({ source: "parse", detail: error });
        }
        return;
      }
      case "user_interruption":
        handlers.onUserInterruption?.();
        return;
      case "assistant_end":
        handlers.onAssistantEnd?.();
        return;
      case "error":
        handlers.onError?.({ source: "hume", detail: parsed });
        return;
      default:
        return;
    }
  }

  function shouldReconnect(code?: number): boolean {
    if (reconnect === false) return false;
    if (closedByCaller) return false;
    if (code !== undefined && NON_RETRYABLE_CLOSE_CODES.has(code)) return false;
    return attempts < reconnect.maxAttempts;
  }

  function scheduleReconnect(): void {
    if (reconnect === false) return;
    attempts += 1;
    const delay = Math.min(
      reconnect.maxDelayMs,
      reconnect.baseDelayMs * 2 ** (attempts - 1),
    );
    setState("reconnecting");
    reconnectTimer = setTimeout(open, delay);
  }

  function open(): void {
    if (closedByCaller) return;
    setState("connecting");

    const factory =
      webSocketFactory ??
      ((url: string) => new WebSocket(url) as unknown as WebSocketLike);

    try {
      socket = factory(buildUrl());
    } catch (error) {
      handlers.onError?.({ source: "socket", detail: error });
      setState("closed");
      return;
    }

    socket.onopen = () => {
      attempts = 0;
      setState("open");
      sendSessionSettings();
      handlers.onOpen?.();
      if (maxSessionMs && maxSessionMs > 0) {
        sessionTimer = setTimeout(() => {
          // 無音でも課金されるので、上限が渡されているなら自分から閉じる。
          closedByCaller = true;
          setState("closing");
          socket?.close(1000, "max session duration reached");
        }, maxSessionMs);
      }
    };

    socket.onmessage = (event) => dispatch(event.data);

    socket.onerror = (event) => {
      handlers.onError?.({ source: "socket", detail: event });
    };

    socket.onclose = (event) => {
      clearTimers();
      const willReconnect = shouldReconnect(event?.code);
      handlers.onClose?.({ code: event?.code, reason: event?.reason, willReconnect });
      socket = null;
      if (willReconnect) {
        scheduleReconnect();
        return;
      }
      setState("closed");
    };
  }

  return {
    get state() {
      return state;
    },

    connect() {
      if (state === "connecting" || state === "open" || state === "reconnecting") return;
      closedByCaller = false;
      attempts = 0;
      open();
    },

    sendAudio(frame: ArrayBuffer) {
      if (!socket || socket.readyState !== OPEN) return;
      socket.send(JSON.stringify({ type: "audio_input", data: encodeBase64(frame) }));
    },

    send(message: Record<string, unknown>) {
      if (!socket || socket.readyState !== OPEN) return;
      socket.send(JSON.stringify(message));
    },

    close(code = 1000, reason = "client closed") {
      closedByCaller = true;
      clearTimers();
      if (!socket) {
        setState("closed");
        return;
      }
      setState("closing");
      socket.close(code, reason);
    },
  };
}
