"use client";

import * as React from "react";

import { announceAudioPlay, subscribeAudioPlay } from "@/lib/audio/audio-bus";
import { trackAudioPlay } from "@/lib/firebase/behavior-tracker";

/**
 * 記事内の音声 (楽曲プレイリスト / インタビュー) を鳴らす層。
 *
 * 1 記事につき `<audio>` は 1 つだけ持ち、曲を切り替えるときは src を差し替える。
 * 曲ごとに要素を作ると、前の曲が止まりきる前に次が鳴り始めて二重再生になる。
 *
 * 状態は BGM 側 (`audio-provider.tsx`) と同じ考え方で `status` に集約する:
 * - idle     停止中
 * - loading  再生を要求したがまだ音が出ていない (ネットワーク待ち)
 * - playing  実際に音が出ている
 * - error    再生できなかった
 *
 * loading では経過・総尺を `--:--` にしシークを不能に見せる
 * (「押しても無言」の窓を作らないため)。
 *
 * BGM との排他は `lib/audio/audio-bus.ts` 経由。再生開始を放送し、他が鳴り
 * 始めたら自分を止める。
 *
 * Media Session API に載せるのはこちら側だけ。BGM は環境音なので、ロック画面や
 * イヤホンのボタンに出るべきは「いま読んでいる記事の音」の方。
 *
 * ## 設置場所 — ルートレイアウト (2026-08-16 改修)
 *
 * 以前はこの provider を `AudioBlock` の内側 (= 記事ページ) に置いていた。
 * 「音声ブロックの無い記事では audio 要素を作らない」ためだったが、その代償と
 * して **ページ遷移で provider ごと unmount され、再生が必ず止まっていた**。
 * SoundCloud 方式 (遷移しても鳴り続ける) は provider がルートに常駐している
 * ことが前提なので、`app/[locale]/layout.tsx` へ引き上げた。
 *
 * 常駐化による負荷は `new Audio()` を 1 つ持つだけ。`src` は最初の再生要求まで
 * 空で、`preload="metadata"` も src が入って初めて効くのでネットワークは動かない。
 *
 * 引き上げに伴い、行動ログ用の `contentId` / `kind` は provider の props では
 * なく **トラック側** (`ArticleAudioTrack`) が持つ。provider はもうどの記事に
 * いるかを知らないため。
 */

export type ArticleAudioStatus = "idle" | "loading" | "playing" | "error";

export type ArticleAudioTrack = {
  /** 同一記事内で一意なら何でもよい (曲順など)。 */
  id: string;
  src: string;
  title: string;
  /** Media Session に出すアルバム・番組名。 */
  album?: string;
  artworkUrl?: string;
  /**
   * 事前計算した波形。0..1 に正規化した振幅の配列。
   * 無い場合は `lib/audio/peaks.ts` が src から決定的なプレースホルダを作る
   * (クライアントで全量デコードはしない)。
   */
  peaks?: number[];
  /** 行動ログに残すコンテンツ ID (記事 slug)。 */
  contentId?: string;
  /** 行動ログに残す種別。 */
  kind?: "track" | "interview";
  /** 展開パネルから記事へ戻るための導線。 */
  href?: string;
};

type ArticleAudioContextValue = {
  /** いま読み込まれている音源。未選択なら null。 */
  current: ArticleAudioTrack | null;
  status: ArticleAudioStatus;
  /** 秒。取得できていないうちは 0。 */
  currentTime: number;
  /** 秒。メタデータ未取得なら null (= 総尺不明)。 */
  duration: number | null;
  /** 押した曲が今のものなら一時停止、違えば読み込んで再生する。 */
  toggle: (track: ArticleAudioTrack) => void;
  seek: (seconds: number) => void;
  /** 下部バーの「閉じる」。停止して選択も解除する。 */
  stop: () => void;
  /** 全画面 (SP) / 大型パネル (PC) を開いているか。 */
  isExpanded: boolean;
  setExpanded: (next: boolean) => void;
};

const noop = () => {};

const ArticleAudioContext = React.createContext<ArticleAudioContextValue>({
  current: null,
  status: "idle",
  currentTime: 0,
  duration: null,
  toggle: noop,
  seek: noop,
  stop: noop,
  isExpanded: false,
  setExpanded: noop,
});

export function ArticleAudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = React.useState<ArticleAudioTrack | null>(null);
  const [status, setStatus] = React.useState<ArticleAudioStatus>("idle");
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState<number | null>(null);
  const [isExpanded, setExpanded] = React.useState(false);

  // --- <audio> の生成とイベント配線 -------------------------------------
  React.useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    // `play` は要求が受理されただけで音はまだ鳴っていない。実際に鳴るのは
    // `playing`。この 2 つを分けないと「押したのに無反応」の窓ができる。
    const onPlay = () => setStatus("loading");
    const onPlaying = () => setStatus("playing");
    const onWaiting = () => setStatus("loading");
    const onPause = () => setStatus((s) => (s === "error" ? s : "idle"));
    const onEnded = () => {
      setStatus("idle");
      setCurrentTime(0);
    };
    const onError = () => setStatus("error");
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () =>
      setDuration(Number.isFinite(audio.duration) ? audio.duration : null);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  // --- BGM との排他 ------------------------------------------------------
  React.useEffect(
    () =>
      subscribeAudioPlay((owner) => {
        if (owner === "article") return;
        const audio = audioRef.current;
        if (audio && !audio.paused) audio.pause();
      }),
    []
  );

  const toggle = React.useCallback(
    (track: ArticleAudioTrack) => {
      const audio = audioRef.current;
      if (!audio) return;

      const isSameTrack = current?.id === track.id && current?.src === track.src;

      if (isSameTrack && !audio.paused) {
        audio.pause();
        return;
      }

      if (!isSameTrack) {
        // 曲を差し替える。前の曲の再生位置・総尺は持ち越さない。
        audio.src = track.src;
        setCurrent(track);
        setCurrentTime(0);
        setDuration(null);
      }

      // 押した瞬間から loading にする。`play` イベントを待つと、押しても
      // 数秒間まったく反応が無いように見える。
      setStatus("loading");
      // 先に BGM を止める。順番が逆だと、一瞬とはいえ二重に鳴る。
      announceAudioPlay("article");

      audio
        .play()
        .then(() => {
          if (track.contentId) {
            trackAudioPlay({
              contentId: track.contentId,
              kind: track.kind ?? "track",
              title: track.title,
            });
          }
        })
        .catch(() => {
          // 握り潰さない。自動再生ブロックも音源の失敗もユーザーからは
          // 「押したのに鳴らない」で同じなので、UI に出して再試行させる。
          setStatus("error");
        });
    },
    [current]
  );

  const seek = React.useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(Math.max(seconds, 0), audio.duration);
    setCurrentTime(audio.currentTime);
  }, []);

  const stop = React.useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setCurrent(null);
    setStatus("idle");
    setCurrentTime(0);
    setDuration(null);
    setExpanded(false);
  }, []);

  // --- Media Session (ロック画面・イヤホンのボタン) ----------------------
  React.useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;

    if (!current) {
      session.metadata = null;
      session.playbackState = "none";
      return;
    }

    session.metadata = new MediaMetadata({
      title: current.title,
      artist: "elxea",
      ...(current.album ? { album: current.album } : {}),
      ...(current.artworkUrl
        ? { artwork: [{ src: current.artworkUrl, sizes: "512x512" }] }
        : {}),
    });
    session.playbackState = status === "playing" ? "playing" : "paused";

    session.setActionHandler("play", () => toggle(current));
    session.setActionHandler("pause", () => audioRef.current?.pause());
    session.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") seek(details.seekTime);
    });

    return () => {
      session.setActionHandler("play", null);
      session.setActionHandler("pause", null);
      session.setActionHandler("seekto", null);
    };
  }, [current, status, toggle, seek]);

  const value = React.useMemo(
    () => ({
      current,
      status,
      currentTime,
      duration,
      toggle,
      seek,
      stop,
      isExpanded,
      setExpanded,
    }),
    [current, status, currentTime, duration, toggle, seek, stop, isExpanded]
  );

  return (
    <ArticleAudioContext.Provider value={value}>{children}</ArticleAudioContext.Provider>
  );
}

export function useArticleAudio() {
  return React.useContext(ArticleAudioContext);
}

/** `0:00` / `12:34` 形式。総尺が不明なうちは `--:--`。 */
export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
