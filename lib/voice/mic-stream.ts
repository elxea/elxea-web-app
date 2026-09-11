/**
 * マイクの音を 16kHz・モノラル・16bit の生データにして 1 フレームずつ外へ渡す層。
 *
 * ## この層が持たない方針 (重要)
 *
 * 「押して話す」か「常時聞く」かはまだ決まっていない (設計書 U-1)。どちらに決まっても
 * 作り直しにならないよう、この層は **開く / 閉じるの明示 API だけ**を持ち、いつ呼ぶかを
 * 一切知らない。設定値も `lib/config/spec.ts` から読まず、すべて引数で受け取る。
 *
 * - **マイクの許可はここでは求めない。** 取得済みの `MediaStream` を受け取る。
 *   許可ダイアログは画面を見ることを強制するので、明示的なタップの中でしか出さない
 *   (設計書 D-3)。その判断は画面側の責務であり、この層に降ろすと守れなくなる。
 * - **AudioContext もここでは作らない。** iOS は利用者の操作の中で作った器でないと
 *   音を出せない。器の生成は「マイクボタンを押したその操作」の中で行う必要がある。
 *
 * ## 落とし穴: 話し終わったあとの無音送り (実機で確定済み)
 *
 * 話し終わっても、**無音を送り続けないと Hume が「話し終わった」と判定しない**。
 * よって停止は「停止要求 → 無音を送り切る → 切断」の順で行う。逆にすると最後の
 * 発話が丸ごと消える。既定 1500ms (1000〜2000 の範囲で実機調整・設計書 U-6)。
 */

/** Hume に申告するサンプルレート。worklet の間引き先と必ず同じ値を使う。 */
export const VOICE_SAMPLE_RATE = 16000;

/** 1 フレームのサンプル数。16kHz の 20ms 分。 */
export const VOICE_FRAME_SIZE = 320;

/** 停止時に送り切る無音の長さ (ms)。実機で 1000〜2000 の範囲を調整する。 */
export const DEFAULT_TRAILING_SILENCE_MS = 1500;

/** worklet の配置先。`public/worklets/pcm-recorder.worklet.js` に対応する。 */
export const PCM_RECORDER_WORKLET_URL = "/worklets/pcm-recorder.worklet.js";

/**
 * マイク取得時に必ず付ける制約。
 *
 * 付けないとスピーカーから出た自分の返事をマイクが拾い、それが Hume に送られて
 * また返事になる (無限ループ)。この層は `getUserMedia` を呼ばないので、呼び出し側が
 * この定数をそのまま使うこと。使ったかどうかは `createMicStream` が起動時に実測する。
 */
export const VOICE_MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

export type MicStreamState = "idle" | "running" | "stopping" | "stopped";

export type MicStreamOptions = {
  /** 取得済みのマイク入力。許可の取得もトラックの停止も呼び出し側の責務。 */
  stream: MediaStream;
  /** 利用者の操作の中で作られた AudioContext。この層では作らない。 */
  audioContext: AudioContext;
  /** 16kHz・モノラル・16bit のフレーム (リトルエンディアン) が 1 つ出来るたびに呼ばれる。 */
  onFrame: (frame: ArrayBuffer) => void;
  /** 既定 16000。Hume への申告値と必ず揃えること (ずれると丸ごと無音扱いになる)。 */
  targetSampleRate?: number;
  /** 既定 320。 */
  frameSize?: number;
  /** 停止時に送り切る無音の長さ (ms)。既定 1500。0 なら送らない。 */
  trailingSilenceMs?: number;
  /** worklet の URL。既定 `/worklets/pcm-recorder.worklet.js`。 */
  workletUrl?: string;
  /** エコー消しが無効なまま渡されたときの通知先 (起動は止めない)。 */
  onWarning?: (message: string) => void;
  onError?: (error: unknown) => void;
};

export type MicStream = {
  /** マイクを配線して送出を始める。二重に呼んでも 1 回しか効かない。 */
  start: () => Promise<void>;
  /**
   * 停止要求 → 無音を送り切る → 配線を外す、の順で止める。
   * 返る Promise は無音を送り切ったあとで解決する。`MediaStream` のトラックは
   * 止めない (器と同じく、作った側が閉じる)。
   */
  stop: () => Promise<void>;
  readonly state: MicStreamState;
};

/** 1 つの AudioContext に同じ worklet を二重登録しないための記録。 */
const registeredWorklets = new WeakMap<BaseAudioContext, Set<string>>();

async function ensureWorkletModule(context: AudioContext, url: string): Promise<void> {
  let registered = registeredWorklets.get(context);
  if (!registered) {
    registered = new Set<string>();
    registeredWorklets.set(context, registered);
  }
  if (registered.has(url)) return;
  await context.audioWorklet.addModule(url);
  registered.add(url);
}

export function createMicStream(options: MicStreamOptions): MicStream {
  const {
    stream,
    audioContext,
    onFrame,
    targetSampleRate = VOICE_SAMPLE_RATE,
    frameSize = VOICE_FRAME_SIZE,
    trailingSilenceMs = DEFAULT_TRAILING_SILENCE_MS,
    workletUrl = PCM_RECORDER_WORKLET_URL,
    onWarning,
    onError,
  } = options;

  let state: MicStreamState = "idle";
  let source: MediaStreamAudioSourceNode | null = null;
  let worklet: AudioWorkletNode | null = null;
  let sink: GainNode | null = null;
  let stopping: Promise<void> | null = null;

  /** 1 フレーム分の実時間 (ms)。無音を送る間隔に使う。 */
  const frameDurationMs = (frameSize / targetSampleRate) * 1000;

  function warnIfEchoCancellationOff(): void {
    if (!onWarning) return;
    for (const track of stream.getAudioTracks()) {
      const settings = track.getSettings();
      if (settings.echoCancellation === false) {
        onWarning(
          "エコー消しが無効なマイク入力が渡された。自分の返事を拾って無限ループになる。" +
            "getUserMedia に VOICE_MIC_CONSTRAINTS を渡すこと。",
        );
      }
    }
  }

  function teardown(): void {
    try {
      worklet?.port.postMessage({ type: "stop" });
    } catch {
      // 既に閉じている場合は何もしない。
    }
    source?.disconnect();
    worklet?.disconnect();
    sink?.disconnect();
    if (worklet) worklet.port.onmessage = null;
    source = null;
    worklet = null;
    sink = null;
  }

  /**
   * 無音を実時間どおりのペースで送り切る。
   *
   * まとめて一気に送らないのは、Hume 側が受け取った音の長さで「話し終わった」を
   * 判定するため。実時間より速く送ると判定が前倒しになり、前倒しの量が端末の速さで
   * 変わる = 再現しない不具合になる。
   */
  function flushTrailingSilence(): Promise<void> {
    if (trailingSilenceMs <= 0) return Promise.resolve();

    const frameCount = Math.max(1, Math.round(trailingSilenceMs / frameDurationMs));
    let sent = 0;

    return new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        try {
          // 16bit なので 1 サンプル 2 バイト。ゼロ埋めがそのまま無音。
          onFrame(new ArrayBuffer(frameSize * 2));
        } catch (error) {
          onError?.(error);
        }
        sent += 1;
        if (sent >= frameCount) {
          clearInterval(timer);
          resolve();
        }
      }, frameDurationMs);
    });
  }

  return {
    get state() {
      return state;
    },

    async start() {
      if (state !== "idle") return;
      state = "running";

      try {
        warnIfEchoCancellationOff();

        // 器が止まっていると worklet は 1 サンプルも回らない。無音を送っている
        // つもりで何も送っていない状態になるので、ここで必ず起こす。
        if (audioContext.state === "suspended") await audioContext.resume();

        await ensureWorkletModule(audioContext, workletUrl);

        source = audioContext.createMediaStreamSource(stream);
        worklet = new AudioWorkletNode(audioContext, "pcm-recorder", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: { targetSampleRate, frameSize },
        });

        worklet.port.onmessage = (event: MessageEvent) => {
          if (state !== "running") return;
          if (event.data instanceof ArrayBuffer) onFrame(event.data);
        };

        // 音量 0 の出口を経由して destination に繋ぐ。出口が無いと処理グラフが
        // 引かれず worklet が回らない実装があるため。音量 0 なのでマイクの音が
        // スピーカーに回り込むことはない。
        sink = audioContext.createGain();
        sink.gain.value = 0;
        source.connect(worklet);
        worklet.connect(sink);
        sink.connect(audioContext.destination);
      } catch (error) {
        state = "stopped";
        teardown();
        onError?.(error);
        throw error;
      }
    },

    async stop() {
      if (state === "idle") {
        state = "stopped";
        return;
      }
      if (stopping) return stopping;
      if (state === "stopped") return;

      state = "stopping";

      stopping = (async () => {
        // 先にマイクを外す。外さずに無音を送ると、実際の音と無音が混ざって
        // 「話し終わった」の判定が遅れる。
        source?.disconnect();
        await flushTrailingSilence();
        teardown();
        state = "stopped";
      })();

      return stopping;
    },
  };
}
