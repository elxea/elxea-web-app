"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * `status` は「今この瞬間ユーザーに何を見せるべきか」の唯一の根拠。
 *
 * - idle     停止中 (初期状態・一時停止後)
 * - loading  再生を要求したがまだ音が出ていない (ネットワーク待ち・バッファ待ち)
 * - playing  実際に音が出ている
 * - error    再生できなかった (自動再生ブロック・ネットワーク断・デコード失敗)
 *
 * 以前は `play()` の失敗を `catch(() => {})` で握り潰し、`error` イベントも
 * 拾っていなかったため、押しても何も起きない・原因も分からない状態だった。
 */
export type AudioStatus = "idle" | "loading" | "playing" | "error";

type AudioContextValue = {
  isPlaying: boolean;
  /** 再生要求は出したがまだ音が鳴っていない (bgm.mp3 のダウンロード待ちを含む)。 */
  isLoading: boolean;
  /** 直近の再生失敗。成功・停止でクリアされる。 */
  error: AudioError | null;
  status: AudioStatus;
  toggle: () => void;
};

/**
 * 失敗の種類。UI 文言と「再試行させるか」の判断に使う。
 * - `blocked`  ブラウザが自動再生を拒否した (ユーザー操作が要る)
 * - `source`   音源を読めない / デコードできない (ネットワーク断・404・破損)
 * - `unknown`  上記に当てはまらない
 */
export type AudioError = { kind: "blocked" | "source" | "unknown" };

const AudioContext = createContext<AudioContextValue>({
  isPlaying: false,
  isLoading: false,
  error: null,
  status: "idle",
  toggle: () => {},
});

const POSITION_KEY = "elxea-bgm-position";

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AudioError | null>(null);

  useEffect(() => {
    const audio = new Audio("/audio/bgm.mp3");
    audio.loop = true;
    audio.volume = 0.3;
    audio.preload = "none";

    // Restore saved playback position once metadata is loaded.
    // Setting currentTime before loadedmetadata is a no-op on many browsers.
    const handleLoadedMetadata = () => {
      try {
        const savedPosition = localStorage.getItem(POSITION_KEY);
        if (savedPosition) {
          const pos = parseFloat(savedPosition);
          if (!isNaN(pos) && pos > 0 && pos < audio.duration) {
            audio.currentTime = pos;
          }
        }
      } catch {}
    };
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);

    // Sync isPlaying state with actual audio element events.
    // `play` は「再生要求が受理された」だけで音はまだ鳴っていない
    // (bgm.mp3 のダウンロード待ちがここに入る)。実際に音が出るのは `playing`。
    const onPlay = () => {
      setIsPlaying(true);
      setIsLoading(true);
    };
    const onPlaying = () => {
      setIsPlaying(true);
      setIsLoading(false);
      setError(null);
    };
    const onWaiting = () => setIsLoading(true);
    const onPause = () => {
      setIsPlaying(false);
      setIsLoading(false);
    };
    // 音源そのものが読めない場合 (404 / ネットワーク断 / デコード失敗)。
    // `play()` の promise は解決してしまうことがあるので、element の error も拾う。
    const onError = () => {
      setIsPlaying(false);
      setIsLoading(false);
      setError({ kind: "source" });
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    audioRef.current = audio;

    // 再生位置を5秒ごとに保存
    const saveInterval = setInterval(() => {
      if (audio && !audio.paused && isFinite(audio.currentTime)) {
        try {
          localStorage.setItem(POSITION_KEY, String(audio.currentTime));
        } catch {}
      }
    }, 5000);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      // 離脱時に最終位置を保存
      if (audio && isFinite(audio.currentTime)) {
        try {
          localStorage.setItem(POSITION_KEY, String(audio.currentTime));
        } catch {}
      }
      clearInterval(saveInterval);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      // 押した瞬間から loading にする。`play` イベントを待つと、押しても
      // 数秒間まったく反応が無いように見えるため。
      setIsLoading(true);
      setError(null);
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((cause: unknown) => {
          // 失敗を握り潰さない。ブラウザの自動再生ブロック (NotAllowedError) と
          // 音源側の失敗 (NotSupportedError 等) を分けて UI に渡す。
          const name =
            cause instanceof Error ? cause.name : String(cause ?? "");
          setIsPlaying(false);
          setIsLoading(false);
          setError({
            kind:
              name === "NotAllowedError"
                ? "blocked"
                : name === "NotSupportedError" || name === "AbortError"
                  ? "source"
                  : "unknown",
          });
        });
    } else {
      audio.pause();
      setIsPlaying(false);
      setIsLoading(false);
      setError(null);
      try {
        localStorage.setItem(POSITION_KEY, String(audio.currentTime));
      } catch {}
    }
  }, []);

  const status: AudioStatus = error
    ? "error"
    : isLoading
      ? "loading"
      : isPlaying
        ? "playing"
        : "idle";

  return (
    <AudioContext.Provider value={{ isPlaying, isLoading, error, status, toggle }}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio() {
  return useContext(AudioContext);
}
