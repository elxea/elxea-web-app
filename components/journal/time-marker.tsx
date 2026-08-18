import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * TimeMarker — Figma
 * `TimeMarker (Proposed) — elxea/Journal 章見出し=時刻` 7552:23574。
 *
 * Figma 実測 (AWLnI0XF07e8rScuxPYPc7) — variant は文字倍率:
 * - Ratio=1.3x 7552:23559 …… 139 x 44
 * - Ratio=2.0x 7552:23566 …… 181 x 44
 * - Ratio=3.6x 7552:23573 …… 278 x 78
 *   - Dial (細線円 44px) 7552:23568 …… 44 x 44
 *   - 時刻 7552:23572 …… x=60 (= 44 + 16 / spacing.4)
 *
 * 3 variant を通して「ダイヤル 44px + 溝 16px + 時刻テキスト」の構造は同じで、
 * 差分は時刻の文字倍率だけ (1rem x ratio)。よってコード側も variant を並べず
 * `ratio` 一本にしている。1.3x / 2.0x で高さ 44 なのはダイヤル律速、3.6x で 78 に
 * なるのは文字律速 (57.6px x 行高 1.35 = 77.8) で、この計算と一致する。
 */
export const TIME_MARKER_RATIOS = [1.3, 2.0, 3.6] as const;
export type TimeMarkerRatio = (typeof TIME_MARKER_RATIOS)[number];

export type TimeMarkerProps = Omit<React.ComponentProps<"h2">, "children"> & {
  /** 表示する時刻 (例「6:40」)。章見出しそのもの。 */
  time: string;
  /** 文字倍率。Figma の Ratio variant と 1:1。 */
  ratio?: TimeMarkerRatio;
  /** 見出しレベル。ページ内の階層に合わせて変える。 */
  as?: "h2" | "h3" | "h4";
};

export function TimeMarker({
  time,
  ratio = 2.0,
  as: Comp = "h2",
  className,
  ...props
}: TimeMarkerProps) {
  return (
    <Comp
      data-slot="time-marker"
      data-ratio={ratio}
      className={cn("flex items-center gap-4", className)}
      {...props}
    >
      {/* Dial (細線円 44px) — 装飾。読み上げからは外す。 */}
      <span
        aria-hidden="true"
        data-slot="time-marker-dial"
        className="size-(--component-timeMarker-dial-size-default) shrink-0 rounded-full border border-border"
      />
      <span
        data-slot="time-marker-time"
        className="leading-snug tabular-nums"
        style={{ fontSize: `${ratio}rem` }}
      >
        {time}
      </span>
    </Comp>
  );
}
