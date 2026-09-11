import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ScaleBar — Figma `ScaleBar (Proposed) — elxea/みんなの気配 相対量バー` 7840:39260。
 *
 * Figma 実測 (AWLnI0XF07e8rScuxPYPc7):
 * - symbol 7840:39260 …… 360 x 3
 * - filled 7840:39258 …… x=0 w=240 (= 2/3)
 * - rest   7840:39259 …… x=240 w=120
 *
 * 幅は親に従う (360 は Figma のプレビュー幅であって固定値ではない)。高さのみ
 * `component.scaleBar.height.default` に束縛する。
 *
 * 目盛りではなく「相対量」の提示なので `role="meter"`。値は読み上げに必要なので
 * `aria-valuenow` と `aria-label` を必須にしている (装飾扱いにしない)。
 */
export type ScaleBarProps = Omit<
  React.ComponentProps<"div">,
  "children" | "role"
> & {
  /** 0-1 の比率。範囲外は clamp する。 */
  value: number;
  /** 何の相対量かを述べるラベル。読み上げに使う。 */
  label: string;
};

export function ScaleBar({ value, label, className, ...props }: ScaleBarProps) {
  const ratio = Math.min(1, Math.max(0, value));
  const percent = Math.round(ratio * 100);

  return (
    <div
      data-slot="scale-bar"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
      className={cn(
        "h-(--component-scaleBar-height-default) w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      {...props}
    >
      <div
        data-slot="scale-bar-filled"
        className="h-full rounded-full bg-foreground"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
