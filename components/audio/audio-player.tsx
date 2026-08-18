"use client";

import * as React from "react";
import { PauseIcon, PlayIcon } from "lucide-react";

import { captionClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

import {
  formatTime,
  useArticleAudio,
  type ArticleAudioTrack,
} from "./article-audio-provider";

/**
 * AudioPlayer — Figma `AudioPlayer (Proposed) — elxea/Journal` (7047:6363)。
 *
 * 記事内で音を鳴らす本体。出す情報は経過 / シーク / 総尺の 3 つだけで、
 * 音量・速度は出さない (Figma の component description)。
 *
 * Figma 実測 (px) → 実装:
 * - 高さ 64 / 幅は親いっぱい          → `h-16 w-full`
 * - 面 mode/card + 1px border + radius-lg 8 → `bg-card border border-border rounded-lg`
 * - 内側 padding 16 x 12 / gap 12     → `px-4 py-3 gap-3`
 * - 再生ボタン 40 円 / 塗り foreground → `size-10 rounded-full bg-foreground`
 *   Loading は muted-foreground に落とす
 * - 時間表示 caption 12 / muted-foreground
 * - シーク帯 高さ 6 / 全丸め / 溝 mode/muted / 進捗 foreground
 * - Loading は全体を不透明度 70% にし、経過・総尺を `--:--`、シークを不能にする
 *
 * シークは `<input type="range">` で組む。div + クリック座標だとキーボードと
 * 支援技術から操作できないため (見た目だけ Figma に寄せて操作できない部品は
 * 作らない)。見た目は `appearance-none` + 疑似要素で Figma の帯に合わせる。
 */
export function AudioPlayer({
  track,
  labels,
  className,
}: {
  track: ArticleAudioTrack;
  labels: { play: string; pause: string; loading: string; seek: string; error: string };
  className?: string;
}) {
  const { current, status, currentTime, duration, toggle, seek } = useArticleAudio();

  const isCurrent = current?.id === track.id;
  const isPlaying = isCurrent && status === "playing";
  const isLoading = isCurrent && status === "loading";
  const isError = isCurrent && status === "error";

  // 別の曲が鳴っているときは、この行は自分の 0:00 を出す (他人の再生位置を
  // 自分の進捗として出さない)。
  const elapsed = isCurrent ? currentTime : 0;
  const total = isCurrent ? duration : null;
  const canSeek = isCurrent && total !== null;

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <div
        data-slot="audio-player"
        data-state={isLoading ? "loading" : isPlaying ? "playing" : "paused"}
        className={cn(
          "flex h-16 w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3",
          isLoading && "opacity-70"
        )}
      >
        <button
          type="button"
          onClick={() => toggle(track)}
          aria-label={isPlaying ? labels.pause : labels.play}
          aria-busy={isLoading}
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-background",
            "transition-colors duration-fast",
            isLoading ? "bg-muted-foreground" : "bg-foreground hover:bg-brand-charcoal",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
          )}
        >
          {isPlaying ? (
            <PauseIcon aria-hidden="true" className="size-4 fill-current" />
          ) : (
            <PlayIcon aria-hidden="true" className="size-4 fill-current" />
          )}
        </button>

        <span className={cn(captionClass, "shrink-0 tabular-nums text-muted-foreground")}>
          {isLoading ? "--:--" : formatTime(elapsed)}
        </span>

        <input
          type="range"
          min={0}
          max={total ?? 0}
          step={1}
          value={canSeek ? Math.min(elapsed, total) : 0}
          disabled={!canSeek}
          aria-label={labels.seek}
          onChange={(event) => seek(Number(event.target.value))}
          className="audio-seek min-w-0 flex-1"
          style={{
            // 進捗の塗り分けは背景のグラデーションで作る (疑似要素だと
            // ブラウザ間で当たる要素名が違い、片方だけ塗れない事故が起きる)。
            ["--audio-progress" as string]:
              canSeek && total > 0 ? `${(elapsed / total) * 100}%` : "0%",
          }}
        />

        <span className={cn(captionClass, "shrink-0 tabular-nums text-muted-foreground")}>
          {isLoading ? "--:--" : formatTime(total)}
        </span>
      </div>

      {isError ? (
        <p role="alert" className={cn(captionClass, "text-destructive")}>
          {labels.error}
        </p>
      ) : null}
    </div>
  );
}
