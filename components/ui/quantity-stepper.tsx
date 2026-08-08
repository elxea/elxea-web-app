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
      >
        {/* U+2212 MINUS SIGN — Figma 6906:337 と同一字形 (ハイフンではない) */}
        <span aria-hidden="true">&#8722;</span>
      </Button>
      <span
        data-slot="quantity-stepper-value"
        className="text-foreground w-8 text-center text-sm tracking-normal"
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
      >
        <span aria-hidden="true">+</span>
      </Button>
    </div>
  );
}
