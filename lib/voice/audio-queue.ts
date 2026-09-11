/**
 * Hume が細切れで返す返事を、継ぎ目なく鳴らすための再生キュー。
 *
 * ## なぜ通常の音声再生要素 (`<audio>`) ではないのか
 *
 * Hume は返事を 1 本のファイルではなく短いチャンクの列で返す。`<audio>` は
 * 「1 本のソースを頭から鳴らす」道具なので、チャンクごとに差し替えると必ず
 * 継ぎ目で途切れる。AudioContext の時間軸に「前のチャンクが終わる時刻」から
 * 詰めて予約すれば、途切れずに繋がる。
 *
 * ## この層が交通整理への放送の唯一の呼び出し元
 *
 * `announceAudioPlay("voice")` / `announceAudioRelease("voice")` を呼ぶのは
 * **このファイルだけ**。他のどのファイルからも放送しない。放送する場所が増えると
 * 「同時に鳴る音は 1 つ」を決める場所が分裂する (単一正本原則)。
 *
 * ## AudioContext は引数で受け取る
 *
 * iOS は利用者の操作なしに音を出せない。器はマイクボタンを押した**その操作の中**で
 * 作る必要があり、それは画面側の責務なのでこの層では作らない。
 */

import { announceAudioPlay, announceAudioRelease } from "@/lib/audio/audio-bus";

import type { AudioOwner } from "@/lib/audio/audio-bus";

/**
 * 予約を入れるときの最小の先読み (秒)。
 *
 * 「今すぐ」で予約すると、予約処理そのものにかかる時間だけ過去になり、頭が欠ける。
 * 人間には知覚できない長さの余裕を持たせる。
 */
export const DEFAULT_SCHEDULE_LOOKAHEAD_SEC = 0.05;

/** Hume の返事の音声形式。既定は容器付き (wav/mp3 等) で、ブラウザに解かせる。 */
export type VoiceChunkFormat = "container" | "pcm16";

export type AudioQueueOptions = {
  /** 利用者の操作の中で作られた AudioContext。この層では作らない。 */
  audioContext: AudioContext;
  /** 交通整理に名乗る名前。既定 `"voice"`。 */
  owner?: AudioOwner;
  /** 既定 `"container"`。`"pcm16"` の場合は `pcmSampleRate` も渡すこと。 */
  format?: VoiceChunkFormat;
  /** `format: "pcm16"` のときの入力サンプルレート。 */
  pcmSampleRate?: number;
  /** 予約の先読み (秒)。既定 0.05。 */
  lookaheadSec?: number;
  /** 無音から鳴り始めた瞬間 (放送のあと) に呼ばれる。 */
  onPlaybackStart?: () => void;
  /** 予約が尽きて鳴り終わった瞬間 (放送のあと) に呼ばれる。 */
  onPlaybackEnd?: () => void;
  onError?: (error: unknown) => void;
};

export type AudioQueue = {
  /** チャンクを 1 つ足す。届いた順に鳴る。 */
  enqueue: (chunk: ArrayBuffer) => void;
  /** 予約を全部捨てて即座に黙る (割り込まれたとき)。場は解放する。 */
  clear: () => void;
  /** 使い終わり。以後 enqueue しても鳴らない。 */
  dispose: () => void;
  readonly isPlaying: boolean;
};

export function createAudioQueue(options: AudioQueueOptions): AudioQueue {
  const {
    audioContext,
    owner = "voice",
    format = "container",
    pcmSampleRate,
    lookaheadSec = DEFAULT_SCHEDULE_LOOKAHEAD_SEC,
    onPlaybackStart,
    onPlaybackEnd,
    onError,
  } = options;

  /** 次のチャンクを鳴らし始める時刻 (AudioContext の時間軸)。 */
  let nextStartTime = 0;
  let playing = false;
  let disposed = false;
  let pending = 0;
  const active = new Set<AudioBufferSourceNode>();

  // 解く処理は非同期なので、そのまま並べると届いた順に鳴るとは限らない。
  // 1 本の鎖に繋いで順序を保証する。
  let chain: Promise<void> = Promise.resolve();

  function beginPlaybackIfIdle(): void {
    if (playing) return;
    playing = true;
    // 鳴り始めを放送する。BGM・記事音声はこれを見て自分を止める。
    announceAudioPlay(owner);
    onPlaybackStart?.();
  }

  function endPlaybackIfDrained(): void {
    if (!playing) return;
    if (pending > 0 || active.size > 0) return;
    playing = false;
    // 場を空けたことを放送する。これが無いと音声のあと BGM が戻らない。
    announceAudioRelease(owner);
    onPlaybackEnd?.();
  }

  /** 生の 16bit データを AudioBuffer に組み直す (`format: "pcm16"` 用)。 */
  function decodePcm16(chunk: ArrayBuffer): AudioBuffer {
    if (!pcmSampleRate) {
      throw new Error('format: "pcm16" には pcmSampleRate が要る');
    }
    const samples = new Int16Array(chunk);
    const buffer = audioContext.createBuffer(1, samples.length, pcmSampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      channel[index] = samples[index] / 0x8000;
    }
    return buffer;
  }

  async function toAudioBuffer(chunk: ArrayBuffer): Promise<AudioBuffer> {
    if (format === "pcm16") return decodePcm16(chunk);
    // decodeAudioData は渡した ArrayBuffer を空にする。使い回さないよう複製する。
    return audioContext.decodeAudioData(chunk.slice(0));
  }

  function schedule(buffer: AudioBuffer): void {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    // 前のチャンクが終わる時刻から詰める。遅れて届いた場合 (前の再生が既に
    // 終わっている) は「今 + 先読み」から鳴らす。
    const startAt = Math.max(audioContext.currentTime + lookaheadSec, nextStartTime);
    source.onended = () => {
      active.delete(source);
      endPlaybackIfDrained();
    };
    active.add(source);
    source.start(startAt);
    nextStartTime = startAt + buffer.duration;

    beginPlaybackIfIdle();
  }

  return {
    get isPlaying() {
      return playing;
    },

    enqueue(chunk: ArrayBuffer) {
      if (disposed) return;
      pending += 1;
      // 解き終わる前に「鳴っている」と宣言しておく。解くのに数十 ms かかる間に
      // BGM が鳴り続けると、その分だけ二重に聞こえる。
      beginPlaybackIfIdle();

      chain = chain
        .then(async () => {
          if (disposed) return;
          const buffer = await toAudioBuffer(chunk);
          if (disposed) return;
          schedule(buffer);
        })
        .catch((error: unknown) => {
          onError?.(error);
        })
        .finally(() => {
          pending -= 1;
          endPlaybackIfDrained();
        });
    },

    clear() {
      nextStartTime = 0;
      for (const source of [...active]) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // まだ start していない / 既に終わっている場合は何もしない。
        }
        source.disconnect();
      }
      active.clear();
      // 解き途中のものは disposed 以外では止められないので、鎖の末尾で
      // pending が 0 になった時点で解放が放送される。ここでは即座に黙らせる。
      if (playing && pending === 0) {
        playing = false;
        announceAudioRelease(owner);
        onPlaybackEnd?.();
      }
    },

    dispose() {
      disposed = true;
      for (const source of [...active]) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // 同上。
        }
        source.disconnect();
      }
      active.clear();
      if (playing) {
        playing = false;
        announceAudioRelease(owner);
      }
    },
  };
}
