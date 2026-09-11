"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * QuantityStepper — 数量ステッパ (Figma `Stepper / Qty (Proposed) — elxea/cart 数量`
 * 6906:335)。
 *
 * Figma 実測 (px) → 実装の対応:
 * - 全体        gap 4 / items-center                → `gap-1 items-center`
 * - minus/plus  24 x 24 / radius 6 / border 1 /
 *               bg = `background` / border = `border`
 *               → DS `Button variant="outline" size="icon-xs"`
 *                 (size-6 = 24px / rounded-md = 6px / border + bg-background)
 *   ※Figma のレイヤー名が `[DS:Button outline size=icon-xs]` なので、DS Button に
 *     そのまま束縛するのが Figma の指示どおり。
 * - 数値        w 32 / center / `Text-sm/Regular` (14 / 400 / lh 20 / tracking 0)
 *               → `w-8 text-center text-sm tracking-normal`
 *   ※`Text-sm/*` は shadcn プリミティブのスケール (editorial スケールではない) なので
 *     `typography.style.*` ではなく Tailwind の text-sm を使う。`tracking-normal` は
 *     body の letter-spacing 継承 (.04em) を打ち消して Figma の tracking 0 に合わせる。
 *
 * 生 px / 生カラーは書かない。寸法は Tailwind spacing scale (= spacing.* トークンと
 * 同じ 0.25rem 刻み)、色は semantic token。
 */

/**
 * SP のタップ域を 44 に広げる (C17-1 / Q2)。
 *
 * Figma の minus / plus は 24x24 なので、指で押す面としては WCAG 2.5.5
 * (Target Size / AAA 44px) を満たさない。**見た目 (視覚サイズ 24 / 罫線 / 角丸 /
 * 塗り) は Figma のまま**にして、擬似要素だけを 44x44 に広げて当たり判定にする。
 * C8-1 の「静かな導線のタップ域 24 → 44」(c8-1 §注22) と同じ考え方で、
 * あちらは枠の見た目が無い文字リンクなので `min-h-11` で枠ごと広げられたが、
 * ここは枠に罫線と塗りがある = 枠を広げると Figma と違う見た目になるため
 * 擬似要素方式にする。
 *
 * 44 の枠は水平方向に ±10 はみ出す (24 → 44)。ステッパ全体は
 * `[24][gap 4][数値 32][gap 4][24]` = 88 なので
 * minus の枠 = -10..34 / plus の枠 = 54..98 で **両者は重ならない**
 * (中央 34..54 の 20px は数値の中央でどちらの当たり判定にも入らない)。
 * 右隣の「削除」までは `gap-4` = 16 空いており、plus のはみ出し 10 に収まる。
 *
 * 数値の `<span>` は 28..60 を占め、両端 6px ずつが枠と重なる。span が上に
 * 乗ると 6px ぶんクリックを奪うので `pointer-events-none` を当てて素通しする
 * (読み上げは `aria-label` に残るので a11y は不変)。
 *
 * PC は Figma どおり 24 のまま (`lg:before:hidden`)。ポインタ操作で 44 は不要な上、
 * PC は「削除」との距離が同じなので広げる利得が無い。
 */
const HIT_AREA_44_SP = cn(
  "relative",
  "before:absolute before:top-1/2 before:left-1/2 before:size-11 before:content-['']",
  "before:-translate-x-1/2 before:-translate-y-1/2",
  "lg:before:hidden",
);

export type QuantityStepperProps = {
  /** 現在の数量。 */
  value: number;
  /** 数量変更。減算で min を下回る操作は minus 側が disabled になる。 */
  onChange: (next: number) => void;
  /** 下限 (既定 1)。0 を渡すと「0 = 削除」の運用にできる。 */
  min?: number;
  disabled?: boolean;
  /** minus / plus / 数値表示に付ける aria-label の接頭辞 (例 "数量")。 */
  label: string;
  className?: string;
};

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  disabled,
  label,
  className,
}: QuantityStepperProps) {
  return (
    <div
      data-slot="quantity-stepper"
      className={cn("flex items-center gap-1", className)}
    >
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= min}
        aria-label={`${label} -1`}
        className={HIT_AREA_44_SP}
      >
        {/* U+2212 MINUS SIGN — Figma 6906:337 と同一字形 (ハイフンではない) */}
        <span aria-hidden="true">&#8722;</span>
      </Button>
      <span
        data-slot="quantity-stepper-value"
        /* pointer-events-none は上の HIT_AREA_44_SP の注記どおり
           (44 の当たり判定と重なる両端 6px を span が奪わないようにする)。 */
        className="text-foreground pointer-events-none w-8 text-center text-sm tracking-normal"
        aria-label={label}
      >
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        onClick={() => onChange(value + 1)}
        disabled={disabled}
        aria-label={`${label} +1`}
        className={HIT_AREA_44_SP}
      >
        <span aria-hidden="true">+</span>
      </Button>
    </div>
  );
}
