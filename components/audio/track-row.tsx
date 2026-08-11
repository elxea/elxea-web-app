"use client";

import * as React from "react";
import { Loader2Icon, PauseIcon, PlayIcon } from "lucide-react";

import { bodySmClass, captionClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

import {
  formatTime,
  useArticleAudio,
  type ArticleAudioTrack,
} from "./article-audio-provider";

/**
 * TrackRow — Figma `TrackRow (Module) — elxea/Journal 楽曲行` (8174:25)。
 *
 * 曲リストの 1 行。押すとその曲を鳴らし、鳴っている行だけが card 面に反転する。
 *
 * Figma 実測 (px) → 実装:
 * - 行高 68 / py 8 / gap 16                  → `min-h-17 py-2 gap-4`
 * - 再生ボタンのタップ域 44                   → `size-11`
 * - default   面なし / 再生記号 foreground
 * - playing   行が mode/card に反転 + 角丸 radius-md + px 12
 *             再生ボタンが mode/primary で塗られ記号は primary-foreground
 * - loading   行全体を不透明度 70%
 * - 曲名 body-sm 14 / 尺 caption 12 muted-foreground
 *
 * 尺は音源のメタデータが読めるまで分からない。Figma は静止画なので固定値が
 * 入っているが、実装では `--:--` から始めて読めた時点で差し替える
 * (存在しない数字を先に見せない)。CMS 側に長さがある場合はそれを初期値に使う。
 */
export function TrackRow({
  track,
  /** CMS が持っている長さ (秒)。無ければ音源のメタデータを待つ。 */
  fallbackDuration,
  labels,
  className,
}: {
  track: ArticleAudioTrack;
  fallbackDuration?: number | null;
  labels: { play: string; pause: string };
  className?: string;
}) {
  const { current, status, duration, toggle } = useArticleAudio();

  const isCurrent = current?.id === track.id;
  const isPlaying = isCurrent && status === "playing";
  const isLoading = isCurrent && status === "loading";

  const shownDuration = isCurrent && duration !== null ? duration : (fallbackDuration ?? null);

  return (
    <div
      data-slot="track-row"
      data-state={isLoading ? "loading" : isPlaying ? "playing" : "default"}
      className={cn(
        "flex min-h-17 w-full items-center gap-4 py-2 transition-colors duration-200",
        isPlaying ? "rounded-md bg-card px-3" : "px-0",
        isLoading && "opacity-70",
        className
      )}
    >
      <button
        type="button"
        onClick={() => toggle(track)}
        aria-label={`${isPlaying ? labels.pause : labels.play}: ${track.title}`}
        aria-busy={isLoading}
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
          isPlaying
            ? "bg-primary text-primary-foreground"
            : "text-foreground hover:bg-muted active:bg-secondary",
          isLoading && "text-muted-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        {isLoading ? (
          <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
        ) : isPlaying ? (
          <PauseIcon aria-hidden="true" className="size-4 fill-current" />
        ) : (
          <PlayIcon aria-hidden="true" className="size-4 fill-current" />
        )}
      </button>

      <span className={cn(bodySmClass, "min-w-0 flex-1 text-foreground")}>{track.title}</span>

      <span className={cn(captionClass, "shrink-0 tabular-nums text-muted-foreground")}>
        {formatTime(shownDuration)}
      </span>
    </div>
  );
}
