/**
 * 音声とテキストが **1 本の会話** であり続けることを機械的に縛る。
 *
 * 正本: 設計書 D-3 / D-4
 * https://app.notion.com/p/3d870c9d064c81798c41cd5135be44f0
 *
 * ## なぜこのテストが要るか
 *
 * オーナーの「実用」の定義は「どちらの入力方式・出力方式でも同じデータを扱って
 * やり取りができること」。機能が全部動いても会話が 2 本に割れたら実用にならない。
 * 割れ方は画面を見ても分からない (次にタブを開いたとき初めて「声で話した分だけ
 * 抜けた履歴」として出る) ので、目視では守れない。だから縛る。
 *
 * 縛る契約:
 *   1. 音声中は文字を送れない / 文字の生成中は音声を始められない (D-4「同時進行の禁止」)
 *   2. 音声が終わったら履歴の作り置きを捨てる (D-4 (3))
 *   3. `user_message` / `assistant_message` を受けたら**即座に**会話へ 1 通足す (D-4 (2))
 *   4. 会話の合図 (`session_handle`) を加工せず Hume へ渡す (D-4 (1))
 *   5. マイク拒否の 4 分岐がそれぞれ正しい状態になる (D-3)
 *   6. タップ 1 回の中の順序: 再生の器 → マイクの許可 (D-3)
 *
 * ## Hume への実接続は 0 回
 *
 * 残枠が約 21 秒しかないので、このテストは **1 秒も接続しない**。
 * `webSocketFactory` に偽物を注入し、さらに `globalThis.WebSocket` を
 * 「呼ばれたら落ちる」実装に差し替えて、取りこぼしが起きないようにしてある
 * (最後のテストがその差し替えが一度も呼ばれていないことを確認する)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createVoiceController,
  classifyMicFailure,
  isInAppBrowser,
  shouldShowMicButton,
  isMicButtonEnabled,
  shouldAutoStopAfterReply,
  VOICE_INTERACTION_MODE,
  VOICE_MESSAGES,
  type VoiceAvailability,
  type VoiceChatPort,
} from "@/components/voice/voice-provider";
import {
  buildVoiceMessage,
  isTextSendBlocked,
  discardHistoryCacheForVoice,
} from "@/components/chat/chat-provider";
import { writeCachedHistory, type HistoryIdentity } from "@/lib/chat/history-cache";
import { VOICE_MIC_CONSTRAINTS } from "@/lib/voice/mic-stream";
import type { WebSocketLike } from "@/lib/voice/hume-socket";

// ---------------------------------------------------------------------------
// 偽物
// ---------------------------------------------------------------------------

/** 本物の `WebSocket` が使われたら必ず落ちる。Hume 実接続 0 回の最後の砦。 */
let realSocketAttempts = 0;

class FakeHumeSocket implements WebSocketLike {
  static instances: FakeHumeSocket[] = [];

  readyState = 1;
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose:
    | ((event: { code?: number; reason?: string; wasClean?: boolean }) => void)
    | null = null;

  constructor(readonly url: string) {
    FakeHumeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  /** サーバから 1 通届いたことにする。 */
  emit(payload: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  /** 送ったメッセージのうち `type` が一致する最初の 1 通。 */
  find(type: string): Record<string, unknown> | undefined {
    for (const raw of this.sent) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.type === type) return parsed;
    }
    return undefined;
  }
}

type FakeTrack = { stop: ReturnType<typeof vi.fn>; getSettings: () => MediaTrackSettings };

function makeMediaStream(): { stream: MediaStream; track: FakeTrack } {
  const track: FakeTrack = {
    stop: vi.fn(),
    getSettings: () => ({ echoCancellation: true }) as MediaTrackSettings,
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

function makeAudioContext(): { context: AudioContext; closed: () => boolean } {
  let isClosed = false;
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const context = {
    state: "running" as AudioContextState,
    currentTime: 0,
    sampleRate: 48000,
    destination: node(),
    audioWorklet: { addModule: vi.fn(async () => undefined) },
    createMediaStreamSource: vi.fn(node),
    createGain: vi.fn(() => ({ ...node(), gain: { value: 1 } })),
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => {
      isClosed = true;
    }),
  };
  return { context: context as unknown as AudioContext, closed: () => isClosed };
}

/** 会話の入れ物への口。呼ばれた順と中身を全部残す。 */
function makeChatPort(isTextBusy = () => false) {
  const appended: Array<{ role: string; text: string }> = [];
  const voiceActiveCalls: boolean[] = [];
  const port: VoiceChatPort = {
    appendVoiceMessage: (role, text) => appended.push({ role, text }),
    setVoiceActive: (active) => voiceActiveCalls.push(active),
    isTextBusy,
  };
  return { port, appended, voiceActiveCalls };
}

/** `Storage` の最小実装 (作り置きの読み書きに本物の実装を通すため)。 */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  } as Storage;
}

const TOKEN = {
  access_token: "test-access-token",
  expires_in: 1800,
  /** 元に戻せない文字列。**この値がそのまま Hume へ渡ること**が D-4 の根幹。 */
  session_handle: "v1:aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkk",
};

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(
  overrides: {
    isTextBusy?: () => boolean;
    getUserMedia?: () => Promise<MediaStream>;
    queryMicPermission?: () => Promise<PermissionState | null>;
    hasAudioInput?: () => Promise<boolean>;
    userAgent?: string;
    enabled?: boolean;
  } = {},
) {
  const chat = makeChatPort(overrides.isTextBusy);
  const media = makeMediaStream();
  const audio = makeAudioContext();
  /** タップ 1 回の中でやったことの順番 (D-3 の順序を縛る)。 */
  const order: string[] = [];

  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    order.push("getUserMedia");
    if (overrides.getUserMedia) return overrides.getUserMedia();
    void constraints;
    return media.stream;
  });

  const controller = createVoiceController({
    chat: chat.port,
    configId: "test-config-id",
    enabled: overrides.enabled ?? true,
    userAgent: () => overrides.userAgent ?? "Mozilla/5.0 (iPhone) Safari",
    createAudioContext: () => {
      order.push("createAudioContext");
      return audio.context;
    },
    getUserMedia,
    queryMicPermission:
      overrides.queryMicPermission ?? (async () => "prompt" as PermissionState),
    hasAudioInput: overrides.hasAudioInput ?? (async () => true),
    fetchToken: async () => TOKEN,
    webSocketFactory: (url) => new FakeHumeSocket(url),
  });

  return { controller, chat, media, audio, order, getUserMedia };
}

/** 開始して、繋がった状態 (`onopen` 済み) にする。 */
async function startAndOpen(h: Harness): Promise<FakeHumeSocket> {
  await h.controller.start();
  const socket = FakeHumeSocket.instances.at(-1);
  if (!socket) throw new Error("偽の WebSocket が作られていない");
  socket.onopen?.({});
  return socket;
}

beforeEach(() => {
  FakeHumeSocket.instances = [];
  realSocketAttempts = 0;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = class {
    constructor() {
      realSocketAttempts += 1;
      throw new Error("本物の WebSocket が使われた (Hume 実接続禁止)");
    }
  };
  (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = class {
    port = { onmessage: null as unknown, postMessage: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (1) 同時進行の禁止
// ---------------------------------------------------------------------------

describe("同時進行の禁止 (D-4)", () => {
  it("音声中は文字を送れない", () => {
    expect(
      isTextSendBlocked({ text: "こんにちは", sessionId: "s-1", voiceActive: true }),
    ).toBe(true);
    /* 旗が降りていれば同じ入力が通る = 旗以外の理由で塞いでいない。 */
    expect(
      isTextSendBlocked({ text: "こんにちは", sessionId: "s-1", voiceActive: false }),
    ).toBe(false);
  });

  it("会話 ID が未解決 / 空文字なら音声の有無に関係なく送らない", () => {
    expect(
      isTextSendBlocked({ text: "こんにちは", sessionId: "", voiceActive: false }),
    ).toBe(true);
    expect(
      isTextSendBlocked({ text: "   ", sessionId: "s-1", voiceActive: false }),
    ).toBe(true);
  });

  it("文字の生成中は音声を開始できない (器もマイクも触らない)", async () => {
    const h = makeHarness({ isTextBusy: () => true });

    await h.controller.start();

    expect(h.getUserMedia).not.toHaveBeenCalled();
    expect(h.order).toEqual([]);
    expect(h.chat.voiceActiveCalls).toEqual([]);
    expect(h.controller.state).toBe("idle");
    expect(FakeHumeSocket.instances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (2) タップ 1 回の中の順序 + 会話の合図
// ---------------------------------------------------------------------------

describe("開始の順序と会話の合図 (D-3 / D-4 (1))", () => {
  it("再生の器を作ってからマイクの許可を求める", async () => {
    const h = makeHarness();

    await startAndOpen(h);

    /* iPhone は利用者の操作なしに音を出せない。許可ダイアログのあとに器を作ると
       「話しかけたのに無言」になる。順序そのものが仕様。 */
    expect(h.order).toEqual(["createAudioContext", "getUserMedia"]);
  });

  it("エコー消し・雑音抑制・自動音量調整を全部有効にしてマイクを取る", async () => {
    const h = makeHarness();

    await startAndOpen(h);

    expect(h.getUserMedia).toHaveBeenCalledWith({ audio: VOICE_MIC_CONSTRAINTS });
    expect(VOICE_MIC_CONSTRAINTS.echoCancellation).toBe(true);
    expect(VOICE_MIC_CONSTRAINTS.noiseSuppression).toBe(true);
    expect(VOICE_MIC_CONSTRAINTS.autoGainControl).toBe(true);
  });

  it("窓口が返した会話の合図を加工せず Hume へ渡す", async () => {
    const h = makeHarness();

    const socket = await startAndOpen(h);

    const settings = socket.find("session_settings");
    expect(settings?.custom_session_id).toBe(TOKEN.session_handle);
    /* 生の値を作り直していない = 文字チャットと同じ会話に入る。 */
    expect(String(settings?.custom_session_id)).toMatch(/^v1:/);
  });

  it("開始したら会話の入れ物に音声中の旗が立つ", async () => {
    const h = makeHarness();

    await startAndOpen(h);

    expect(h.chat.voiceActiveCalls).toEqual([true]);
    expect(h.controller.state).toBe("listening");
  });
});

// ---------------------------------------------------------------------------
// (3) 話している最中の即時表示
// ---------------------------------------------------------------------------

describe("話している最中の即時表示 (D-4 (2))", () => {
  it("user_message / assistant_message を受けたら即座に会話へ 1 通足す", async () => {
    const h = makeHarness();
    const socket = await startAndOpen(h);

    socket.emit({
      type: "user_message",
      message: { role: "user", content: "ほうじ茶のおすすめある？" },
      models: { prosody: { scores: { Calmness: 0.7 } } },
    });
    socket.emit({
      type: "assistant_message",
      message: { role: "assistant", content: "焙煎の浅いものからいかがですか" },
    });

    /* 履歴の取り直しを待たずに、届いた時点で会話に入っている。 */
    expect(h.chat.appended).toEqual([
      { role: "user", text: "ほうじ茶のおすすめある？" },
      { role: "assistant", text: "焙煎の浅いものからいかがですか" },
    ]);
  });

  it("音声から足す 1 通には音声の印が付く", () => {
    const message = buildVoiceMessage("user", "こんにちは", "2026-09-12T00:00:00.000Z");

    expect(message.role).toBe("user");
    expect(message.parts).toEqual([{ type: "text", text: "こんにちは" }]);
    expect(message.metadata).toEqual({
      channel: "voice",
      timestamp: "2026-09-12T00:00:00.000Z",
    });
  });
});

// ---------------------------------------------------------------------------
// (4) 音声終了時の作り置き破棄
// ---------------------------------------------------------------------------

describe("音声終了時に履歴の作り置きを捨てる (D-4 (3))", () => {
  it("停止すると旗が降り、掴んだものを全部離す", async () => {
    const h = makeHarness();
    const socket = await startAndOpen(h);

    await h.controller.stop();

    /* 旗を降ろす側が作り置きを捨てる。**この 1 本しか呼ばない** ので、
       「旗は降りたが作り置きは残った」状態が構造的に作れない。 */
    expect(h.chat.voiceActiveCalls).toEqual([true, false]);
    expect(socket.closedWith?.code).toBe(1000);
    expect(h.media.track.stop).toHaveBeenCalled();
    expect(h.audio.closed()).toBe(true);
    expect(h.controller.state).toBe("idle");
  }, 15_000);

  it("捨てる処理は作り置きを実際に空にする", () => {
    const storage = makeStorage();
    const identity: HistoryIdentity = {
      sessionId: "s-1",
      signedIn: false,
      customerId: null,
      lineAuthed: false,
      lineUserId: null,
    };
    writeCachedHistory(storage, identity, { messages: [{ content: "文字で話した分" }] });
    expect(storage.length).toBeGreaterThan(0);

    discardHistoryCacheForVoice(storage);

    expect(storage.length).toBe(0);
  });

  it("会話の入れ物は旗を降ろす経路で作り置きを捨てている", () => {
    /* 上 2 本は「制御側が旗を降ろす」と「捨てる処理が効く」をそれぞれ縛る。
       両者を繋ぐ 1 行が消えると会話は静かに割れるので、その配線も見る
       (React の効果を走らせずに確認できる唯一の手段)。 */
    const source = readFileSync(
      join(process.cwd(), "components/chat/chat-provider.tsx"),
      "utf8",
    );
    const body = /const setVoiceActive = useCallback\(([\s\S]*?)\n  \}, \[\]\);/.exec(
      source,
    );
    expect(body, "setVoiceActive が useCallback で定義されていない").not.toBeNull();
    expect(body?.[1]).toContain("discardHistoryCacheForVoice");
  });
});

// ---------------------------------------------------------------------------
// (5) マイク拒否の 4 分岐
// ---------------------------------------------------------------------------

describe("マイクが使えないときの 4 分岐 (D-3)", () => {
  function micError(name: string): Error {
    const err = new Error(name);
    err.name = name;
    return err;
  }

  it("その場で拒否 — ボタンは残すが押せない。文言は 1 行", async () => {
    const h = makeHarness({
      getUserMedia: async () => {
        throw micError("NotAllowedError");
      },
      queryMicPermission: async () => "prompt" as PermissionState,
    });

    await h.controller.start();

    expect(h.controller.availability).toBe<VoiceAvailability>("denied");
    expect(shouldShowMicButton("denied")).toBe(true);
    expect(isMicButtonEnabled("denied")).toBe(false);
    expect(h.controller.message).toBe("音声は使えません。文字で続けられます。");
    /* 旗は立てない — 許可が降りなかっただけで文字入力まで固めない。 */
    expect(h.chat.voiceActiveCalls).toEqual([]);
    expect(h.controller.state).toBe("idle");
  });

  it("設定で恒久拒否 — 静的な一文を足す。再試行ループを作らない", async () => {
    const h = makeHarness({
      getUserMedia: async () => {
        throw micError("NotAllowedError");
      },
      queryMicPermission: async () => "denied" as PermissionState,
    });

    await h.controller.start();

    expect(h.controller.availability).toBe<VoiceAvailability>("blocked");
    expect(h.controller.message).toContain("ブラウザの設定から許可できます");
    expect(isMicButtonEnabled("blocked")).toBe(false);
    /* 自分から掛け直さない (ダイアログは二度と出ないので無駄に叩かない)。 */
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("マイクが無い — ボタン自体を出さない", async () => {
    const h = makeHarness({
      getUserMedia: async () => {
        throw micError("NotFoundError");
      },
    });

    await h.controller.start();

    expect(h.controller.availability).toBe<VoiceAvailability>("no-microphone");
    expect(shouldShowMicButton("no-microphone")).toBe(false);
    expect(VOICE_MESSAGES["no-microphone"]).toBeNull();
  });

  it("LINE アプリ内ブラウザ — ボタンを出さない。許可も求めない", async () => {
    const h = makeHarness({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Line/14.2.0",
    });

    const availability = await h.controller.probeAvailability();

    expect(availability).toBe<VoiceAvailability>("in-app-browser");
    expect(shouldShowMicButton("in-app-browser")).toBe(false);
    /* 下調べでマイクのダイアログを出さない (D-3「明示的なタップ以外では絶対に求めない」)。 */
    expect(h.getUserMedia).not.toHaveBeenCalled();
    expect(isInAppBrowser("Mozilla/5.0 (iPhone) Safari")).toBe(false);
  });

  it("どの分岐でも文字で続けられる (音声は文字送信の判定に手を出さない)", () => {
    for (const availability of [
      "denied",
      "blocked",
      "no-microphone",
      "in-app-browser",
      "unsupported",
      "disabled",
    ] as VoiceAvailability[]) {
      expect(isMicButtonEnabled(availability)).toBe(false);
      /* 音声が使えなくても、旗が降りている限り文字は通る。 */
      expect(
        isTextSendBlocked({ text: "こんにちは", sessionId: "s-1", voiceActive: false }),
      ).toBe(false);
    }
  });

  it("エラー名から分岐を引く規則が 1 箇所にある", () => {
    expect(classifyMicFailure({ name: "NotAllowedError" }, "prompt")).toBe("denied");
    expect(classifyMicFailure({ name: "NotAllowedError" }, "denied")).toBe("blocked");
    expect(classifyMicFailure({ name: "NotAllowedError" }, null)).toBe("denied");
    expect(classifyMicFailure({ name: "NotFoundError" }, null)).toBe("no-microphone");
    expect(classifyMicFailure({ name: "OverconstrainedError" }, null)).toBe(
      "no-microphone",
    );
    expect(classifyMicFailure(new Error("unknown"), null)).toBe("denied");
  });
});

// ---------------------------------------------------------------------------
// (6) 方式の切り替えと、Hume 実接続 0 回
// ---------------------------------------------------------------------------

describe("方式と費用の歯止め", () => {
  it("既定は押して話す方式で、返事が終わったら自分から切る", () => {
    expect(VOICE_INTERACTION_MODE).toBe("push-to-talk");
    expect(shouldAutoStopAfterReply("push-to-talk")).toBe(true);
    /* 常時聞く方式に切り替えたら開けたままになる = 定数 1 つで挙動が変わる。 */
    expect(shouldAutoStopAfterReply("always-on")).toBe(false);
  });

  it("機能スイッチが切なら何も起きない", async () => {
    const h = makeHarness({ enabled: false });

    await h.controller.start();

    expect(h.controller.availability).toBe<VoiceAvailability>("disabled");
    expect(h.order).toEqual([]);
    expect(FakeHumeSocket.instances).toHaveLength(0);
  });

  it("Hume への実接続は 0 回", async () => {
    const h = makeHarness();
    const socket = await startAndOpen(h);

    /* 繋ぎ先は EVI で合っているが、繋いだのは偽物だけ。 */
    expect(socket.url.startsWith("wss://api.hume.ai/v0/evi/chat")).toBe(true);
    expect(FakeHumeSocket.instances).toHaveLength(1);
    expect(realSocketAttempts).toBe(0);
  });
});
