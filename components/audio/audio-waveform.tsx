"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { PEAKS_BUCKETS, peaksUrl, synthesizePeaks } from "@/lib/audio/peaks";

/**
 * 波形シーク帯。SoundCloud の操作感 (掴んで擦る) を実装したもの。
 *
 * ブランド要素は持ち込まない (Setaka 確定 2026-08-16)。ロゴ・オレンジ等は
 * 一切使わず、色はすべて roji のトークン (`foreground` / `muted-foreground`) から採る。
 * 模しているのは「波形を直接掴んで動かせる」という操作の作法だけ。
 *
 * ## 誤操作対策 (NTS の欠点回避)
 *
 * - `touch-action: none`
 *   これが無いと、波形を横に擦る指をブラウザが「スクロール開始」と解釈して
 *   ページごと動き、iOS ではラバーバンドで跳ねる。ポインタを自前で扱う以上、
 *   ブラウザ側のジェスチャは明示的に降ろす必要がある。
 * - `setPointerCapture`
 *   指が帯の外へ出ても追従させる。捕捉しないと、少し上下にぶれただけで
 *   シークが途切れて「掴んだのに外れる」になる。
 * - タップ域は縦 44px 以上 (`min-h-11`)
 *   波形の見た目が細くても、当たり判定は指のサイズで取る。
 * - `overscroll-behavior: contain`
 *   親のスクロール連鎖を止め、端まで来たときに背後のページが動くのを防ぐ。
 *
 * ## 波形データ
 *
 * `lib/audio/peaks.ts` の方針どおり、事前計算 JSON を取りに行き、無ければ
 * src から決定的に合成する。クライアントで音源をデコードすることはない。
 *
 * ## 描画
 *
 * 同じ棒の列を 2 枚重ね、上の 1 枚を `clip-path` で再生位置まで見せる。
 * 棒 1 本ずつに色を付け直すと、擦っている間じゅう数百ノードの class が
 * 変わって重い。`clip-path` なら 1 プロパティの更新で済む。
 */
export function AudioWaveform({
  src,
  /** CMS 等が直接持っている波形。あればフェッチしない。 */
  peaks: peaksProp,
  /** 0..1。再生位置の割合。 */
  progress,
  /** 掴んで動かしている最中に呼ばれる (プレビュー更新用)。 */
  onScrub,
  /** 指を離した位置で確定するときに呼ばれる。 */
  onSeek,
  disabled = false,
  ariaLabel,
  /** 波形本体の高さ。バーの本数は変えない。 */
  className,
  barClassName,
}: {
  src: string | null;
  peaks?: number[];
  progress: number;
  onScrub?: (ratio: number) => void;
  onSeek: (ratio: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  barClassName?: string;
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const [fetched, setFetched] = React.useState<number[] | null>(null);
  const [isScrubbing, setScrubbing] = React.useState(false);
  const [scrubRatio, setScrubRatio] = React.useState<number | null>(null);

  // --- 波形データの解決 ---------------------------------------------------
  React.useEffect(() => {
    // 直接渡されているなら取りに行かない。
    if (peaksProp || !src) {
      setFetched(null);
      return;
    }

    let cancelled = false;
    // 事前計算済みがあれば使う。無ければ合成にそのまま落ちる (404 は想定内で
    // あって異常ではないので、コンソールを汚さない)。
    fetch(peaksUrl(src))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const values = data?.peaks;
        if (Array.isArray(values) && values.length > 0) setFetched(values);
        else setFetched(null);
      })
      .catch(() => {
        if (!cancelled) setFetched(null);
      });

    return () => {
      cancelled = true;
    };
  }, [src, peaksProp]);

  const peaks = React.useMemo(() => {
    if (peaksProp && peaksProp.length > 0) return peaksProp;
    if (fetched && fetched.length > 0) return fetched;
    if (src) return synthesizePeaks(src);
    // 音源すら無いときは平坦な帯を出す (掴めないことは disabled で示す)。
    return new Array(PEAKS_BUCKETS).fill(0.08);
  }, [peaksProp, fetched, src]);

  // 擦っている間は指の位置を優先して見せる。実際の再生位置が追いつくのを
  // 待つと、指より遅れて動いて「掴んでいる感じ」が消える。
  const shownRatio = scrubRatio ?? progress;
  const clampedRatio = Math.min(1, Math.max(0, shownRatio));

  const ratioFromEvent = React.useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    // 主ボタン以外 (右クリック等) では掴まない。
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const ratio = ratioFromEvent(event.clientX);
    setScrubbing(true);
    setScrubRatio(ratio);
    onScrub?.(ratio);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing || disabled) return;
    const ratio = ratioFromEvent(event.clientX);
    setScrubRatio(ratio);
    onScrub?.(ratio);
  };

  const endScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    const ratio = ratioFromEvent(event.clientX);
    setScrubbing(false);
    setScrubRatio(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onSeek(ratio);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    // 5% 刻み。キーボードで端から端まで 20 回で届く粒度。
    const step = 0.05;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = clampedRatio + step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = clampedRatio - step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    if (next === null) return;
    event.preventDefault();
    onSeek(Math.min(1, Math.max(0, next)));
  };

  const bars = (
    <div aria-hidden="true" className="flex h-full w-full items-center gap-px">
      {peaks.map((peak, index) => (
        <span
          key={index}
          // 角丸は付けない。棒の幅は 1-2px しかなく、トークン最小の radius-sm
          // (4px) を当てると全部が丸い粒になって波形に見えなくなる。
          className={cn("min-w-px flex-1 bg-current", barClassName)}
          style={{ height: `${Math.max(8, peak * 100)}%` }}
        />
      ))}
    </div>
  );

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clampedRatio * 100)}
      aria-disabled={disabled || undefined}
      data-slot="audio-waveform"
      data-scrubbing={isScrubbing || undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onKeyDown={handleKeyDown}
      className={cn(
        // 当たり判定を縦 44px 以上に取る (見た目の帯より広い)。
        "relative flex min-h-11 w-full items-center",
        // ブラウザのスクロール・ラバーバンドを降ろす。これが無いと横に擦った
        // 指でページが動く。
        "[touch-action:none] [overscroll-behavior:contain]",
        // 擦っている間にテキスト選択が走ると、指の軌跡で本文が反転する。
        "select-none",
        disabled ? "cursor-default opacity-60" : "cursor-pointer",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
        className
      )}
    >
      {/* 未再生部分 */}
      <div className="relative h-full w-full text-muted-foreground/50">
        {bars}
        {/* 再生済み部分。同じ棒を重ねて左からの帯で見せる。 */}
        <div
          className="absolute inset-0 text-foreground"
          style={{ clipPath: `inset(0 ${100 - clampedRatio * 100}% 0 0)` }}
        >
          {bars}
        </div>
      </div>
    </div>
  );
}
