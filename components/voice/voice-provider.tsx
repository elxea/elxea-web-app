"use client";

/**
 * 音声の状態管理と、土台 6 本の結線。
 *
 * 正本: 設計書 D-3 / D-4
 * https://app.notion.com/p/3d870c9d064c81798c41cd5135be44f0
 *
 * ## この層が担うたった 1 つのこと
 *
 * **音声とテキストを 1 本の会話に保つ。** 見た目はここで作らない (次のタスク)。
 * 機能が全部動いても会話が 2 本に割れていれば「実用」にならないので、この層では
 * 「分裂させない」が見た目より上に来る。
 *
 * 分裂させないための 4 点 (設計書 D-4) と、この層での置き場所:
 *
 *   1. 会話 ID を共有する — 入場券の窓口が返す `session_handle` を **加工せず**
 *      `createHumeSocket` の `sessionId` に渡す (Hume へは `custom_session_id`
 *      として出る)。ここで作り直すと声と文字が別会話になる
 *   2. 話している最中の即時表示 — `user_message` / `assistant_message` を受けた
 *      時点で `chat.appendVoiceMessage` に渡す。履歴の取り直しを待たない
 *   3. 終了時に履歴の作り置きを捨てる — `chat.setVoiceActive(false)` が捨てる。
 *      止め方がどう転んでも通るよう、後始末の `finally` に置いてある
 *   4. 同時進行の禁止 — 文字側は `chat-provider` の `voiceActive` が止め、
 *      音声側は `chat.isTextBusy()` が止める。**両方向**が要る
 *
 * ## なぜ React の外に状態機械を出してあるのか
 *
 * このリポの unit プロジェクトは `environment: 'node'` で、testing-library も
 * 入っていない (`vitest.config.ts`)。React の中に状態機械を書くと、「音声中に
 * 文字が送れない」「終了で作り置きが捨てられる」といった**壊れたら実用にならない
 * 性質**が機械的に縛れなくなる。しかも割れ方は画面を見ても分からない (次にタブを
 * 開いたとき初めて「声で話した分だけ抜けた履歴」として出る)。
 *
 * そこで中身を `createVoiceController()` という DOM 非依存の素の関数に置き、
 * ブラウザの機能 (AudioContext / getUserMedia / Permissions / WebSocket / fetch)
 * はすべて**引数で渡す**。React の `VoiceProvider` はそれを 1 個作って配るだけの
 * 薄い皮になる。土台 6 本 (`lib/voice/*`) が同じ作法なのと揃えてある。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useChatContext } from "@/components/chat/chat-provider";
import { createRequestCoalescer } from "@/lib/interaction/request-coalescer";
import {
  announceAudioPhase,
  type AudioOwner,
  type AudioPhase,
} from "@/lib/audio/audio-bus";
import {
  createAudioQueue,
  type AudioQueue,
  type AudioQueueOptions,
} from "@/lib/voice/audio-queue";
import {
  createHumeSocket,
  type HumeAssistantMessage,
  type HumeSocket,
  type HumeSocketOptions,
  type HumeUserMessage,
  type WebSocketLike,
} from "@/lib/voice/hume-socket";
import {
  createMicStream,
  VOICE_MIC_CONSTRAINTS,
  type MicStream,
  type MicStreamOptions,
} from "@/lib/voice/mic-stream";
import { env } from "@/lib/config";
import { logger } from "@/lib/log";

// ---------------------------------------------------------------------------
// 方式 (押して話す / 常時聞く)
// ---------------------------------------------------------------------------

export type VoiceInteractionMode = "push-to-talk" | "always-on";

/**
 * 入力方式。**ここ 1 箇所で切り替える。**
 *
 * 既定は「押して話す」。Hume は**無音でつないでいるだけでも課金される**
 * (無音 60 秒が 60.99 秒として記録された実測・設計書 D-5)。残枠が約 21 秒しか
 * ない現状で常時聞く方式にすると費用が読めない。
 *
 * 土台 (`lib/voice/*`) は両対応なので、後から変えられる。差は
 * `shouldAutoStopAfterReply()` の 1 分岐だけ。
 */
export const VOICE_INTERACTION_MODE: VoiceInteractionMode = "push-to-talk";

/**
 * 返事が終わったら自分から切るか。
 *
 * 押して話す方式では切る — **つなぎっぱなしが費用そのもの**だから。常時聞く方式
 * では開けたままにして次の発話を待つ。
 */
export function shouldAutoStopAfterReply(mode: VoiceInteractionMode): boolean {
  return mode === "push-to-talk";
}

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------

/** 音声の状態 (設計書 D-6)。 */
export type VoiceState =
  | "idle"
  | "requesting-permission"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/**
 * 音声が使えるか。設計書 D-3 の 4 分岐 + 使える / 未判定 / 機能切 / 非対応。
 *
 *   - `unknown`         まだ調べていない
 *   - `available`       使える
 *   - `denied`          その場で拒否された (次にまた訊けるかもしれない)
 *   - `blocked`         ブラウザの設定で恒久的に拒否されている (もう訊けない)
 *   - `no-microphone`   マイクが無い
 *   - `in-app-browser`  LINE アプリ内ブラウザ
 *   - `unsupported`     そもそもマイクや音声再生の API が無い
 *   - `disabled`        機能スイッチが切
 */
export type VoiceAvailability =
  | "unknown"
  | "available"
  | "denied"
  | "blocked"
  | "no-microphone"
  | "in-app-browser"
  | "unsupported"
  | "disabled";

/**
 * 上位 (見た目の層) に渡す一行。`null` は「何も出さない」。
 *
 * 判定はこの層が持ち、**表示は上位に渡す** (本タスクは見た目を作らない)。
 * 設計書 D-3 の表どおり:
 *
 *   - その場で拒否 → 「音声は使えません。文字で続けられます。」の 1 行だけ。
 *     **ダイアログを出さない**
 *   - 恒久拒否     → 同上 + 「ブラウザの設定から許可できます。」の静的な一文。
 *     **再試行ループを作らない** (押してもダイアログは二度と出ないため)
 *   - マイク無し / LINE アプリ内 → ボタン自体を出さないので文言も無い
 *
 * どの分岐でも文字はそのまま使える。この層は文字側を一切止めない (止めるのは
 * 音声が実際に動いているあいだだけ)。
 */
export const VOICE_MESSAGES: Record<VoiceAvailability, string | null> = {
  unknown: null,
  available: null,
  denied: "音声は使えません。文字で続けられます。",
  blocked:
    "音声は使えません。文字で続けられます。ブラウザの設定から許可できます。",
  "no-microphone": null,
  "in-app-browser": null,
  unsupported: null,
  disabled: null,
};

/**
 * ボタンを出してよいか (設計書 D-3)。
 *
 * **マイクが無い / LINE アプリ内ブラウザではボタン自体を出さない。** 押せるのに
 * 動かないボタンより、無いほうがいい。拒否の 2 つは「出すが押せない + 1 行」なので
 * 出す。
 */
export function shouldShowMicButton(availability: VoiceAvailability): boolean {
  return (
    availability === "available" ||
    availability === "denied" ||
    availability === "blocked"
  );
}

/** 押せるか。使える状態だけ。押しても無反応なボタンを残さない。 */
export function isMicButtonEnabled(availability: VoiceAvailability): boolean {
  return availability === "available";
}

// ---------------------------------------------------------------------------
// 環境の判定 (純関数)
// ---------------------------------------------------------------------------

/**
 * アプリ内ブラウザ (LINE) か。
 *
 * LINE の内蔵ブラウザは iOS / Android とも UA に `Line/<version>` を載せる。
 * アプリ内ブラウザはマイクの許可を渡さない場合があるので先に弾く (設計書 D-3)。
 *
 * UA 判定は本来あてにならないが、ここは**機能を減らす方向にしか効かない** —
 * 誤検知の害は「音声が出ない」だけで、文字はそのまま使える。
 */
export function isInAppBrowser(userAgent: string): boolean {
  return /\bLine\//i.test(userAgent);
}

/**
 * マイクの許可要求が失敗したとき、どの分岐かを決める。**規則はここ 1 箇所。**
 *
 * @param permission 要求の前後に読んだ `navigator.permissions` の答え。
 *   `NotAllowedError` はその場の拒否と恒久拒否の両方で飛んでくるので、これが
 *   無いと 2 つを見分けられない。読めない環境 (Safari 等) では `null`。
 */
export function classifyMicFailure(
  error: unknown,
  permission: PermissionState | null,
): VoiceAvailability {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  /* 端末にマイクが無い。`NotFoundError` は仕様名、`DevicesNotFoundError` は
     古い Chrome。`OverconstrainedError` は「条件を満たすマイクが 1 本も無い」
     ので、利用者から見れば使えないことに変わりはない。 */
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return "no-microphone";
  }

  /* 拒否。事前に `denied` と分かっていたなら設定で恒久的に切られている。 */
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError"
  ) {
    return permission === "denied" ? "blocked" : "denied";
  }

  /* それ以外 (`NotReadableError` = 他アプリが掴んでいる 等)。使えないことは
     同じなので、退路の出し方も「その場で拒否」と同じにする。 */
  return "denied";
}

// ---------------------------------------------------------------------------
// コントローラ
// ---------------------------------------------------------------------------

/** 入場券の窓口 (`POST /api/voice/token`) が返すもの。 */
export interface VoiceTokenResponse {
  access_token: string;
  expires_in: number;
  /**
   * 会話の合図。**元に戻せない文字列** (`lib/voice/session-id.ts`)。
   *
   * これをそのまま Hume へ渡すことが、音声と文字を 1 本の会話に保つ根幹
   * (設計書 D-4 (1))。作り直したり省いたりすると会話が割れる。
   */
  session_handle: string;
}

/** 会話の入れ物 (`chat-provider`) 側に要求すること。 */
export interface VoiceChatPort {
  /** 外から 1 通足す (設計書 D-4 (2))。 */
  appendVoiceMessage: (
    role: "user" | "assistant",
    text: string,
    timestamp?: string,
  ) => void;
  /**
   * 音声の開始・終了。**`false` 側が履歴の作り置きを捨てる** (設計書 D-4 (3))。
   * 捨てるのは会話の入れ物の責務なので、こちらは伝えるだけ。
   */
  setVoiceActive: (active: boolean) => void;
  /** 文字の生成が走っているか (設計書 D-4「同時進行の禁止」の音声側)。 */
  isTextBusy: () => boolean;
}

/**
 * ブラウザの機能。**全部引数**なので、テストは実ブラウザも実 Hume も要らない
 * (Hume の残枠 21 秒を 1 秒も使わない)。
 */
export interface VoiceControllerPorts {
  chat: VoiceChatPort;
  /** Hume の設定 ID (どの人格・どの声か)。秘密ではない。 */
  configId: string;
  /** 機能スイッチ。切なら何も起きない (設計書 D-1: 未設定なら無効)。 */
  enabled: boolean;
  userAgent: () => string;
  /** 再生の器。**利用者の操作の中で同期的に**作られる必要がある (設計書 D-3)。 */
  createAudioContext: () => AudioContext;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** 読めない環境では `null` を返す。 */
  queryMicPermission: () => Promise<PermissionState | null>;
  hasAudioInput: () => Promise<boolean>;
  fetchToken: () => Promise<VoiceTokenResponse>;
  /** Hume への実接続を差し替える口。テストはここにモックを刺す。 */
  webSocketFactory?: (url: string) => WebSocketLike;
  createSocket?: (options: HumeSocketOptions) => HumeSocket;
  createMic?: (options: MicStreamOptions) => MicStream;
  createQueue?: (options: AudioQueueOptions) => AudioQueue;
  announcePhase?: (owner: AudioOwner, phase: AudioPhase) => void;
  onStateChange?: (state: VoiceState) => void;
  onAvailabilityChange?: (availability: VoiceAvailability) => void;
  logError?: (
    event: string,
    error: unknown,
    context: { operation: string; consequence: string },
  ) => void;
}

export interface VoiceController {
  readonly state: VoiceState;
  readonly availability: VoiceAvailability;
  /** 上位が出す一行 (`VOICE_MESSAGES`)。`null` なら何も出さない。 */
  readonly message: string | null;
  /** 押される前に環境を調べる。**マイクの許可は求めない。** */
  probeAvailability: () => Promise<VoiceAvailability>;
  /** 利用者がマイクを押した。**この呼び出しが操作の中に居ること**が前提。 */
  start: () => Promise<void>;
  /** 終わらせる。何度呼んでも安全。 */
  stop: () => Promise<void>;
}

export function createVoiceController(
  ports: VoiceControllerPorts,
): VoiceController {
  const makeSocket = ports.createSocket ?? createHumeSocket;
  const makeMic = ports.createMic ?? createMicStream;
  const makeQueue = ports.createQueue ?? createAudioQueue;
  const announce = ports.announcePhase ?? announceAudioPhase;
  const logError =
    ports.logError ??
    ((event, error, context) => logger.error(event, error, context));

  let state: VoiceState = "idle";
  let availability: VoiceAvailability = "unknown";

  let audioContext: AudioContext | null = null;
  let micSource: MediaStream | null = null;
  let mic: MicStream | null = null;
  let socket: HumeSocket | null = null;
  let queue: AudioQueue | null = null;

  /** 動いているか。`stop()` を何度呼んでも 1 回しか後始末しないための門。 */
  let running = false;
  /** 後始末の最中。利用者の停止と向こうからの切断が重なっても二重に走らせない。 */
  let stopping: Promise<void> | null = null;

  function setState(next: VoiceState): void {
    if (state === next) return;
    state = next;
    ports.onStateChange?.(next);
  }

  function setAvailability(next: VoiceAvailability): void {
    if (availability === next) return;
    availability = next;
    ports.onAvailabilityChange?.(next);
  }

  /**
   * 押される前の下調べ。
   *
   * **マイクの許可は求めない** (設計書 D-3「明示的なタップ以外では絶対に求めない」)。
   * 許可ダイアログこそ画面を見ることを強制するので、出す回数を最小にする。
   */
  async function probeAvailability(): Promise<VoiceAvailability> {
    if (!ports.enabled) {
      setAvailability("disabled");
      return availability;
    }
    if (isInAppBrowser(ports.userAgent())) {
      setAvailability("in-app-browser");
      return availability;
    }

    try {
      if (!(await ports.hasAudioInput())) {
        setAvailability("no-microphone");
        return availability;
      }
      /* 恒久拒否は押す前に分かる。押せるのに無反応なボタンを出さない。 */
      if ((await ports.queryMicPermission()) === "denied") {
        setAvailability("blocked");
        return availability;
      }
    } catch (err) {
      /* 調べられないなら出さない。「出したのに動かない」より静かに消えるほうが
         まし (文字はそのまま使える)。握り潰さず記録は残す。 */
      logError("voice.availability.probe-failed", err, {
        operation: "VoiceController.probeAvailability",
        consequence: "the mic button is hidden; text chat is unaffected",
      });
      setAvailability("unsupported");
      return availability;
    }

    setAvailability("available");
    return availability;
  }

  /**
   * 1 回のタップの中で、この順序でやる (設計書 D-3・**順序そのものが仕様**):
   *
   *   1. **再生の器を作る** — iPhone は利用者の操作なしに音を出せない。許可
   *      ダイアログのあとに作ると「話しかけたのに無言」になる
   *   2. マイクの許可を取る
   *   3. 交通整理に放送してつなぐ
   *
   * 1 と 2 のあいだに `await` を挟まないのも同じ理由 (Safari は間に非同期が
   * 入ると「操作の中」と認めないことがある)。許可の事前確認は**失敗したときに
   * だけ**読む。
   */
  async function start(): Promise<void> {
    if (running || stopping) return;

    /* 機能スイッチが切なら何も起きない。器もマイクも触らない。 */
    if (!ports.enabled) {
      setAvailability("disabled");
      return;
    }

    /* LINE アプリ内ブラウザでは許可すら求めない。 */
    if (isInAppBrowser(ports.userAgent())) {
      setAvailability("in-app-browser");
      return;
    }

    /* 一度「もう訊けない」と分かった相手に掛け直さない (再試行ループを作らない)。 */
    if (availability === "blocked" || availability === "no-microphone") return;

    /* **文字の生成中は始めない** (設計書 D-4「同時進行の禁止」)。文字側は
       `chat-provider` の `voiceActive` が止める。片側だけだと、先に文字を送って
       から押された場合に同じ会話へ 2 本の生成が走る。 */
    if (ports.chat.isTextBusy()) return;

    running = true;

    /* ---- 1. 再生の器 ---- */
    try {
      audioContext = ports.createAudioContext();
    } catch (err) {
      logError("voice.audio-context.create-failed", err, {
        operation: "VoiceController.start",
        consequence: "voice cannot play back; text chat is unaffected",
      });
      running = false;
      audioContext = null;
      setAvailability("unsupported");
      setState("idle");
      return;
    }

    /* ---- 2. マイクの許可 ---- */
    setState("requesting-permission");
    try {
      micSource = await ports.getUserMedia({ audio: VOICE_MIC_CONSTRAINTS });
    } catch (err) {
      /* 事前確認は**ここで初めて**読む。順序 (器 → 許可) を崩さないため。 */
      let permission: PermissionState | null = null;
      try {
        permission = await ports.queryMicPermission();
      } catch {
        /* 読めないだけ。分岐の材料が無いという事実をそのまま下へ渡す
           (握り潰しではない — 下の `classifyMicFailure` が `null` を扱う)。 */
        permission = null;
      }

      const classified = classifyMicFailure(err, permission);
      logError("voice.microphone.denied", err, {
        operation: "VoiceController.start",
        consequence: `voice is disabled (${classified}); text chat stays available`,
      });
      setAvailability(classified);
      /* **旗は立てない** — 許可が降りなかっただけで文字入力まで固めない。
         ダイアログも出さない・掛け直しもしない (設計書 D-3)。 */
      running = false;
      await releaseResources();
      setState("idle");
      return;
    }

    setAvailability("available");

    /* ---- 3. 交通整理に放送してつなぐ ---- */
    /* 鳴り始めることを先に放送する。記事音声・(将来の) BGM はこれを聞いて自分を
       止める。マイクが開いているあいだスピーカーが黙っている状態こそ、回り込みが
       構造的に起きない状態 (設計書 D-2)。 */
    announce("voice", "start");
    /* つながる前に旗を立てる。接続待ちのあいだに文字を送られると結局 2 本走る。 */
    ports.chat.setVoiceActive(true);
    setState("connecting");

    let token: VoiceTokenResponse;
    try {
      token = await ports.fetchToken();
    } catch (err) {
      logError("voice.token.fetch-failed", err, {
        operation: "VoiceController.start",
        consequence: "the voice session does not start; text chat is unaffected",
      });
      setState("error");
      await stop();
      return;
    }

    try {
      queue = makeQueue({
        audioContext,
        owner: "voice",
        onError: (err) =>
          logError("voice.playback.failed", err, {
            operation: "VoiceController.playback",
            consequence: "one reply is not heard; the session continues",
          }),
      });

      socket = makeSocket({
        accessToken: token.access_token,
        configId: ports.configId,
        /* **会話の合図をそのまま渡す** (設計書 D-4 (1))。`hume-socket` が
           `session_settings.custom_session_id` として送る。ここを省く・作り直すと
           声で話した分が既存の会話に合流できず、会話が 2 本に割れる。 */
        sessionId: token.session_handle,
        webSocketFactory: ports.webSocketFactory,
        handlers: {
          onOpen: () => {
            /* つながった時点で「聞いている」。マイクの配線はこのあと続けるが、
               状態はここで確定させる (利用者から見て待たされる時間を作らない)。 */
            setState("listening");
            void startCapture();
          },
          /* 履歴の取り直しを待たず、受けた時点で会話に足す (設計書 D-4 (2))。
             数秒の遅れは「別の会話に見える」に直結する。 */
          onUserMessage: (message: HumeUserMessage) => {
            const text = message.message?.content ?? "";
            if (text) ports.chat.appendVoiceMessage("user", text);
            setState("thinking");
          },
          onAssistantMessage: (message: HumeAssistantMessage) => {
            const text = message.message?.content ?? "";
            if (text) ports.chat.appendVoiceMessage("assistant", text);
          },
          onAudioChunk: (chunk) => {
            queue?.enqueue(chunk);
            setState("speaking");
          },
          onUserInterruption: () => {
            /* 割り込まれたら鳴らしかけを捨てる。残すと、遮ったはずの返事が
               遅れて流れてくる。 */
            queue?.clear();
            setState("listening");
          },
          onAssistantEnd: () => {
            /* 押して話す方式では返事が終わったら自分から切る。**つなぎっぱなしが
               費用そのもの** (無音でも課金される・設計書 D-5)。 */
            if (shouldAutoStopAfterReply(VOICE_INTERACTION_MODE)) {
              void stop();
              return;
            }
            setState("listening");
          },
          onError: (error) => {
            logError("voice.socket.error", error.detail, {
              operation: `VoiceController.socket(${error.source})`,
              consequence: "the voice session may end; text chat is unaffected",
            });
            setState("error");
          },
          onClose: (event) => {
            /* 向こうから切れた。掛け直す気があるうちは後始末しない
               (`lib/voice/hume-socket.ts` が自分で数えている)。 */
            if (event.willReconnect) return;
            void stop();
          },
        },
      });

      socket.connect();
    } catch (err) {
      logError("voice.session.start-failed", err, {
        operation: "VoiceController.start",
        consequence: "the voice session does not start; text chat is unaffected",
      });
      setState("error");
      await stop();
    }
  }

  /** つながってからマイクを流し始める。つながる前に流しても捨てられるだけ。 */
  async function startCapture(): Promise<void> {
    if (!running || !audioContext || !micSource || !socket) return;
    try {
      mic = makeMic({
        stream: micSource,
        audioContext,
        onFrame: (frame) => socket?.sendAudio(frame),
        onWarning: (message) =>
          logger.warn("voice.microphone.warning", {
            operation: "VoiceController.startCapture",
            detail: message,
          }),
        onError: (err) => {
          logError("voice.microphone.capture-failed", err, {
            operation: "VoiceController.startCapture",
            consequence: "the voice session stops; text chat is unaffected",
          });
          void stop();
        },
      });
      await mic.start();
    } catch (err) {
      logError("voice.microphone.start-failed", err, {
        operation: "VoiceController.startCapture",
        consequence: "the voice session stops; text chat is unaffected",
      });
      setState("error");
      await stop();
    }
  }

  async function stop(): Promise<void> {
    if (stopping) return stopping;
    if (!running) return;
    running = false;
    stopping = teardown().finally(() => {
      stopping = null;
    });
    return stopping;
  }

  /**
   * 後始末。
   *
   * **どう転んでも `setVoiceActive(false)` まで必ず通す。** 途中の例外で飛ばされると
   * 文字入力が永久に無効なまま残り、履歴の作り置きも古いまま残る (次にこのタブで
   * チャットを開くと「声で話した分だけ抜けた履歴」が出る)。だから `finally`。
   */
  async function teardown(): Promise<void> {
    try {
      /* **停止要求 → 無音を送り切る → 切断** の順 (設計書 D-3)。逆にすると最後の
         発話が Hume に「話し終わった」と判定されずに消える。 */
      await mic?.stop();
    } catch (err) {
      logError("voice.microphone.stop-failed", err, {
        operation: "VoiceController.teardown",
        consequence: "the last utterance may be dropped; the session still ends",
      });
    } finally {
      mic = null;
    }

    try {
      socket?.close(1000, "client-stop");
    } catch (err) {
      logError("voice.socket.close-failed", err, {
        operation: "VoiceController.teardown",
        consequence: "the socket is left to time out; the session still ends",
      });
    } finally {
      socket = null;
    }

    try {
      queue?.dispose();
    } catch (err) {
      logError("voice.playback.dispose-failed", err, {
        operation: "VoiceController.teardown",
        consequence: "playback nodes are left to be collected; the session ends",
      });
    } finally {
      queue = null;
    }

    await releaseResources();

    try {
      /* 終わりの放送。これが無いと音声のあと BGM が二度と戻らない
         (設計書 D-2 案 C)。 */
      announce("voice", "release");
    } finally {
      /* **ここが設計書 D-4 (3)。** 文字の送信処理が送信のたびにやっていること
         (履歴の作り置きを捨てる) を、音声の終了時にもやる。旗を降ろす経路が
         これ 1 本しかないので、「旗は降りたが作り置きは残った」が作れない。 */
      ports.chat.setVoiceActive(false);
      if (state !== "error") setState("idle");
    }
  }

  /** マイクと再生の器を離す。許可が降りなかったときも通る。 */
  async function releaseResources(): Promise<void> {
    try {
      for (const track of micSource?.getTracks() ?? []) track.stop();
    } catch (err) {
      logError("voice.microphone.release-failed", err, {
        operation: "VoiceController.releaseResources",
        consequence: "the recording indicator may stay on; the session ends",
      });
    } finally {
      micSource = null;
    }

    try {
      await audioContext?.close?.();
    } catch (err) {
      logError("voice.audio-context.close-failed", err, {
        operation: "VoiceController.releaseResources",
        consequence: "an audio context is leaked; the session still ends",
      });
    } finally {
      audioContext = null;
    }
  }

  return {
    get state() {
      return state;
    },
    get availability() {
      return availability;
    },
    get message() {
      return VOICE_MESSAGES[availability];
    },
    probeAvailability,
    start,
    stop,
  };
}

// ---------------------------------------------------------------------------
// ブラウザ側の実配線 (ports の既定実装)
// ---------------------------------------------------------------------------

/**
 * 入場券の窓口への往復。**共通の通り道 (`lib/interaction`) を通す**。
 *
 * 券は `access_token` と `session_handle` という**応答の本体**が要るので、
 * 成否しか返さない既存の 2 本には載らない。載る形を通り道の側に足したのが
 * `createRequestCoalescer` で、これがその 1 件目の利用者
 * (分類の正本は `lib/interaction/mutation-classes.ts` の `request-response`)。
 *
 * ここに置くことで付いてくるもの: マイクを連打されても**往復は 1 本**に
 * まとまり、2 回目以降も**同じ応答を受け取る** (弾かない・黙って捨てない)。
 * 直に `fetch` を書くと、この整理がどれも付いてこない。
 */
const voiceTokenRequests = createRequestCoalescer<void, VoiceTokenResponse>({
  operation: "voice.token",
});

/** 入場券を取る。**POST のみ** (窓口が GET を受けない・設計書 D-1)。 */
export async function fetchVoiceToken(): Promise<VoiceTokenResponse> {
  const outcome = await voiceTokenRequests.run("voice.token", undefined, async () => {
    const res = await fetch("/api/voice/token", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`voice token request failed: ${res.status}`);
    return (await res.json()) as VoiceTokenResponse;
  });
  /* 呼び出し側 (`createVoiceController`) は例外で受ける作りなので、ここで
     結末を例外へ戻す。通り道の側は相乗りした全員へ同じものを配るために
     値で返している (投げると受け取り手が呼び出し順に依存する)。 */
  if (outcome.status === "failed") throw outcome.error;
  return outcome.data;
}

/** マイクが 1 本でもあるか。許可前でも `kind` は読める。 */
export async function browserHasAudioInput(): Promise<boolean> {
  const media =
    typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media?.getUserMedia) return false;
  try {
    const devices = await media.enumerateDevices();
    return devices.some((d) => d.kind === "audioinput");
  } catch {
    /* 数えられないだけ。「無い」と断定すると使える端末から音声が消えるので、
       あるものとして進め、本当の可否は許可要求の結果で決める。 */
    return true;
  }
}

/** 許可の状態。対応していないブラウザ (Safari 等) では `null`。 */
export async function queryBrowserMicPermission(): Promise<PermissionState | null> {
  if (typeof navigator === "undefined" || !navigator.permissions) return null;
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status?.state ?? null;
  } catch {
    /* Permissions API がマイクに対応していない。事前に見分けられないだけで、
       許可要求そのものは通る。 */
    return null;
  }
}

// ---------------------------------------------------------------------------
// React 側 (薄い皮)
// ---------------------------------------------------------------------------

export interface VoiceContextValue {
  state: VoiceState;
  availability: VoiceAvailability;
  /** ボタンを出すか。 */
  showMicButton: boolean;
  /** ボタンを押せるか。 */
  micButtonEnabled: boolean;
  /** 上位が出す一行。`null` なら何も出さない。 */
  message: string | null;
  mode: VoiceInteractionMode;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

/**
 * 音声の管理役。**会話の入れ物 (`ChatProvider`) の内側に置く** — `useChatContext`
 * を使うため。
 */
export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const chat = useChatContext();
  const [state, setState] = useState<VoiceState>("idle");
  const [availability, setAvailability] = useState<VoiceAvailability>("unknown");
  const [controller, setController] = useState<VoiceController | null>(null);

  /* コントローラに毎回最新の会話の入れ物を見せるための窓。コントローラを作り
     直すとつなぎっぱなしの接続が切れるので、本体は 1 個のまま保ち、中身だけを
     差し替える。**書き込みは描画中ではなく効果の中で行う** (描画中に ref を
     触ると、React が同じ描画を 2 度走らせたときに食い違う)。 */
  const chatRef = useRef(chat);
  useEffect(() => {
    chatRef.current = chat;
  });

  const enabled = Boolean(env("NEXT_PUBLIC_VOICE_ENABLED"));
  const configId = env("NEXT_PUBLIC_HUME_CONFIG_ID") ?? "";

  /* コントローラは**効果の中で**作る。描画中に作ると ref を描画中に読むことに
     なり、React の規則 (`react-hooks/refs`) に反する。 */
  useEffect(() => {
    const created = createVoiceController({
      chat: {
        appendVoiceMessage: (role, text, timestamp) =>
          chatRef.current.appendVoiceMessage(role, text, timestamp),
        setVoiceActive: (active) => chatRef.current.setVoiceActive(active),
        /* 文字の生成中か。`useChat` の状態をそのまま使う — 2 つ目の判定を
           作らない。 */
        isTextBusy: () =>
          chatRef.current.status === "submitted" ||
          chatRef.current.status === "streaming",
      },
      configId,
      /* 設定 ID が無ければ音声は存在しないものとして扱う (設計書 D-1)。 */
      enabled: enabled && Boolean(configId),
      userAgent: () =>
        typeof navigator === "undefined" ? "" : (navigator.userAgent ?? ""),
      createAudioContext: () => new AudioContext(),
      getUserMedia: (constraints) =>
        navigator.mediaDevices.getUserMedia(constraints),
      queryMicPermission: queryBrowserMicPermission,
      hasAudioInput: browserHasAudioInput,
      fetchToken: fetchVoiceToken,
      onStateChange: setState,
      onAvailabilityChange: setAvailability,
    });

    setController(created);
    /* 押される前に調べておく。押してから調べると、タップと `getUserMedia` の
       あいだに `await` が挟まり、iOS が「操作の中」と認めなくなる。 */
    void created.probeAvailability();

    /* 画面から離れるときは必ず終わらせる。**つなぎっぱなしは無音でも課金される**
       (設計書 D-5)。 */
    return () => {
      void created.stop();
    };
  }, [configId, enabled]);

  const start = useCallback(async () => {
    await controller?.start();
  }, [controller]);
  const stop = useCallback(async () => {
    await controller?.stop();
  }, [controller]);

  const value = useMemo<VoiceContextValue>(
    () => ({
      state,
      availability,
      showMicButton: shouldShowMicButton(availability),
      micButtonEnabled: isMicButtonEnabled(availability),
      message: VOICE_MESSAGES[availability],
      mode: VOICE_INTERACTION_MODE,
      start,
      stop,
    }),
    [state, availability, start, stop],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoiceContext(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    throw new Error("useVoiceContext must be used within a VoiceProvider");
  }
  return ctx;
}
