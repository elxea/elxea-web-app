import * as React from "react";

import {
  bodySmClass,
  captionClass,
  h4Class,
} from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * TasteMap — 味×香りマトリクス (Figma PC 8056:1639 / SP 8058:1803)。
 *
 * 「点数」ではなく「淹れ方で動く範囲」を示す図。断定しない (どこが良いかは
 * 決めていない) という編集方針そのものが仕様なので、スコアバーには置き換えない。
 *
 * Figma 実測 (px) → 実装の対応:
 * - マップ         PC 528×528 / SP 343×343      → `aspect-square`
 * - 軸             中央 (PC 263.5 / SP 171)      → `left-1/2` / `top-1/2`
 * - 範囲の点線     PC x80 y64 w384 h392          → 15.15% / 12.12% / 72.73% / 74.24%
 *                  SP x52 y42 w249 h255          → 15.16% / 12.24% / 72.60% / 74.34%
 *                  (PC / SP で比率が一致するので % 1 セットで両対応)
 * - 点             8×8                            → `size-2`
 * - 凡例           PC 右カラム 640 / SP 図の下    → `lg:grid-cols-2`
 *
 * 位置は % で持つ (生 px を書かない)。色は semantic token のみ。
 */

/** 図の中の 1 点。x/y は左上原点の % (0-100)。 */
export type TastePoint = {
  label: string;
  x: number;
  y: number;
  /** ラベルを点の左右どちらに出すか。図の外へはみ出す点だけ "left"。 */
  align?: "left" | "right";
};

export type TasteAxisLabels = {
  aromaHigh: string;
  aromaLow: string;
  tasteLight: string;
  tasteRich: string;
};

export type TasteLegendRow = { term: string; body: string };

const DEFAULT_AXES: TasteAxisLabels = {
  aromaHigh: "香り — 華やか",
  aromaLow: "香り — 穏やか",
  tasteLight: "味 — すっきり",
  tasteRich: "味 — 濃厚",
};

export function TasteMap({
  points,
  axes = DEFAULT_AXES,
  legendLead,
  legendRows,
  className,
}: {
  points: readonly TastePoint[];
  axes?: TasteAxisLabels;
  legendLead: string;
  legendRows: readonly TasteLegendRow[];
  className?: string;
}) {
  return (
    <div
      data-slot="taste-map"
      className={cn("grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-center", className)}
    >
      {/* マップ本体 — 横=味 / 縦=香り */}
      <div
        data-slot="taste-map-plot"
        className="relative aspect-square w-full border border-border"
        role="img"
        aria-label={`${legendLead} ${points.map((p) => p.label).join("、")}`}
      >
        {/* 軸 */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-px bg-border"
          data-slot="taste-map-axis-y"
        />
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-px bg-border"
          data-slot="taste-map-axis-x"
        />

        {/* 淹れ方で動く範囲 (点線の楕円) */}
        <span
          aria-hidden="true"
          data-slot="taste-map-range"
          className="absolute rounded-full border border-dashed border-border"
          style={{ left: "15.15%", top: "12.12%", width: "72.73%", height: "74.24%" }}
        />

        {/* 軸ラベル */}
        <span
          className={cn(
            captionClass,
            "absolute inset-x-0 top-2 text-center text-muted-foreground lg:top-4"
          )}
        >
          {axes.aromaHigh}
        </span>
        <span
          className={cn(
            captionClass,
            "absolute inset-x-0 bottom-2 text-center text-muted-foreground lg:bottom-4"
          )}
        >
          {axes.aromaLow}
        </span>
        <span
          className={cn(
            captionClass,
            "absolute left-2 top-1/2 -translate-y-full pb-1 text-muted-foreground lg:left-4"
          )}
        >
          {axes.tasteLight}
        </span>
        <span
          className={cn(
            captionClass,
            "absolute right-2 top-1/2 -translate-y-full pb-1 text-right text-muted-foreground lg:right-4"
          )}
        >
          {axes.tasteRich}
        </span>

        {/* 点 + ラベル */}
        {points.map((p) => (
          <span
            data-slot="taste-map-point"
            key={p.label}
            className="absolute flex items-center gap-2"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              transform: "translate(-50%, -50%)",
              flexDirection: p.align === "left" ? "row-reverse" : "row",
            }}
          >
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
            <span className={cn(captionClass, "whitespace-nowrap text-foreground")}>
              {p.label}
            </span>
          </span>
        ))}
      </div>

      {/* 凡例 */}
      <div data-slot="taste-map-legend">
        <p className={cn(captionClass, "text-muted-foreground")}>{legendLead}</p>
        <dl className="mt-5 lg:mt-8">
          {legendRows.map((row) => (
            <div
              data-slot="taste-legend-row"
              key={row.term}
              className="flex flex-wrap items-baseline gap-x-3 py-2"
            >
              <dt className={cn(h4Class, "w-16 shrink-0 text-foreground")}>{row.term}</dt>
              <dd className={cn(bodySmClass, "m-0 flex-1 text-muted-foreground")}>
                {row.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
