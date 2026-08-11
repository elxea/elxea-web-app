"use client";

import * as React from "react";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";

import { bodySmClass } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

import { useArticleAudio } from "./article-audio-provider";

/**
 * MiniPlayer — Figma `MiniPlayer (Module) — elxea/共通 追従プレイヤー` (8174:88)。
 *
 * 本体プレイヤーが画面外へ出たときだけ画面下端に追従表示する縮小プレイヤー。
 *
 * なぜ必要か (Figma の component description / WCAG 2.2.2):
 * 鳴っている音を止める手段が同じ画面に常に無ければならない。スクロールで
 * 本体が消えると「鳴っているのに止められない」状態が生まれる。
 *
 * Figma 実測 (px) → 実装:
 * - 全幅 / 面 mode/primary / py 8            → `w-full bg-primary py-2`
 * - 内側 padding SP 16 / PC 24               → `px-4 lg:px-6`
 * - gap 12                                    → `gap-3`
 * - 停止・閉じるとも 44 タップ域              → `size-11`
 * - 文字 body-sm 14 / primary-foreground
 * - z は sticky(1020)。モーダル (1050) より前には出さない
 *
 * 表示条件は「音源が選ばれていて、かつ本体プレイヤーが画面外」。
 * 本体の可視判定は IntersectionObserver で行う (スクロール量の閾値だと
 * 記事の長さやレイアウトで当たり外れが出る)。
 */
export function MiniPlayer({
  /** 本体プレイヤーを包む要素。これが画面外に出たら追従表示する。 */
  anchorRef,
  labels,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  labels: { play: string; pause: string; close: string; nowPlaying: string };
}) {
  const { current, status, toggle, stop } = useArticleAudio();
  const [anchorVisible, setAnchorVisible] = React.useState(true);

  React.useEffect(() => {
    const el = anchorRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setAnchorVisible(entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchorRef]);

  // 音源が選ばれていないうちは何も出さない。停止中でも「選ばれている」間は
  // 出したままにする — 止めた直後にバーごと消えると、再開する手段が
  // 画面外に戻ってしまうため。
  if (!current || anchorVisible) return null;

  const isPlaying = status === "playing";

  return (
    <div
      data-slot="mini-player"
      style={{ zIndex: "var(--z-sticky)" }}
      className="fixed inset-x-0 bottom-0 flex w-full items-center gap-3 bg-primary px-4 py-2 lg:px-6"
    >
      <button
        type="button"
        onClick={() => toggle(current)}
        aria-label={isPlaying ? labels.pause : labels.play}
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full text-primary-foreground",
          "transition-colors duration-200 hover:bg-brand-charcoal",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        {isPlaying ? (
          <PauseIcon aria-hidden="true" className="size-4 fill-current" />
        ) : (
          <PlayIcon aria-hidden="true" className="size-4 fill-current" />
        )}
      </button>

      <p className={cn(bodySmClass, "min-w-0 flex-1 truncate text-primary-foreground")}>
        {labels.nowPlaying} — {current.title}
      </p>

      <button
        type="button"
        onClick={stop}
        aria-label={labels.close}
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full text-primary-foreground",
          "transition-colors duration-200 hover:bg-brand-charcoal",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        <XIcon aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
