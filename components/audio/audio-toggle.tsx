"use client";

import { cn } from "@/lib/utils";
import { useAudio } from "@/components/audio/audio-provider";

type AudioToggleProps = {
  className?: string;
};

/**
 * AudioToggle — サイト BGM の再生 / 停止。
 *
 * 状態表示 (A1): 以前は再生失敗を無言で捨てていたため、押しても何も起きない
 * ときにユーザーが原因を知る手立てが無かった。AudioProvider が持つ
 * `status` (idle / loading / playing / error) をそのまま文言に落とす。
 *
 * 文言は既存実装に合わせて英小文字のまま置く (i18n / aria-pressed / 装飾
 * `✿` の読み上げ・prefers-reduced-motion は A9 = 別スプリントの範囲)。
 */
export function AudioToggle({ className }: AudioToggleProps) {
  const { status, error, toggle } = useAudio();

  const label =
    status === "loading"
      ? "loading"
      : status === "error"
        ? "retry"
        : status === "playing"
          ? "pause"
          : "play";

  // 失敗の理由を 1 行だけ添える。原因で打ち手が変わる (操作を促す / 回線)。
  const note =
    status === "error"
      ? error?.kind === "blocked"
        ? "tap to allow sound"
        : "sound unavailable"
      : "sound from nature";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={status === "loading"}
      aria-busy={status === "loading"}
      className={cn(
        "flex items-center gap-2 text-foreground transition-colors duration-200 cursor-pointer",
        "disabled:cursor-wait disabled:opacity-70",
        className
      )}
      aria-label={
        status === "loading"
          ? "Loading background music"
          : status === "error"
            ? "Background music failed to play — retry"
            : status === "playing"
              ? "Pause background music"
              : "Play background music"
      }
    >
      <span className="text-xs font-medium tracking-widest uppercase underline underline-offset-2 decoration-foreground/40 hover:decoration-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-xs tracking-wide text-muted-foreground inline-block",
          status === "playing" && "animate-spin-slow",
          status === "loading" && "animate-pulse"
        )}
      >
        ✿
      </span>
      <span
        className={cn(
          "text-xs tracking-wide",
          status === "error" ? "text-destructive" : "text-muted-foreground"
        )}
        // 失敗・読み込みは支援技術にも伝える (視覚だけの変化にしない)。
        role={status === "error" ? "status" : undefined}
        aria-live={status === "error" ? "polite" : undefined}
      >
        {note}
      </span>
    </button>
  );
}
