"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { useAudio } from "@/components/audio/audio-provider";

type AudioToggleProps = {
  className?: string;
};

/**
 * AudioToggle — サイト BGM の再生 / 停止。
 *
 * 状態表示 (A1): 再生失敗を無言で捨てず、AudioProvider が持つ
 * `status` (idle / loading / playing / error) をそのまま文言に落とす。
 *
 * i18n / a11y (A9):
 * - 表示文字列と aria-label を messages/{ja,en}.json の `audio.*` に移した
 *   (以前は英語ハードコードで、日本語ページでも "play" / "sound from nature"
 *   が出ていた)。A1 で足した loading / error の文言も同じ場所に集約する。
 * - トグルなので `aria-pressed` を付ける (再生中かどうかを支援技術に伝える)。
 * - 装飾の `✿` は `aria-hidden` にする (「花」と読み上げても意味がない)。
 * - 回転・点滅アニメーションは `prefers-reduced-motion: reduce` で止める
 *   (globals.css 側で `.animate-spin-slow` / `.animate-pulse` を無効化)。
 */
export function AudioToggle({ className }: AudioToggleProps) {
  const { status, error, toggle } = useAudio();
  const t = useTranslations("audio");

  const label =
    status === "loading"
      ? t("stateLoading")
      : status === "error"
        ? t("stateRetry")
        : status === "playing"
          ? t("statePause")
          : t("statePlay");

  const ariaLabel =
    status === "loading"
      ? t("ariaLoading")
      : status === "error"
        ? t("ariaError")
        : status === "playing"
          ? t("ariaPause")
          : t("ariaPlay");

  // 失敗の理由を 1 行だけ添える。原因で打ち手が変わる (操作を促す / 回線)。
  const note =
    status === "error"
      ? error?.kind === "blocked"
        ? t("noteBlocked")
        : t("noteUnavailable")
      : t("noteDefault");

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={status === "loading"}
      aria-busy={status === "loading"}
      aria-pressed={status === "playing"}
      aria-label={ariaLabel}
      className={cn(
        "flex items-center gap-2 text-foreground transition-colors duration-fast cursor-pointer",
        "disabled:cursor-wait disabled:opacity-70",
        className
      )}
    >
      <span className="text-xs font-medium tracking-widest uppercase underline underline-offset-2 decoration-foreground/40 hover:decoration-foreground">
        {label}
      </span>
      <span
        aria-hidden="true"
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
