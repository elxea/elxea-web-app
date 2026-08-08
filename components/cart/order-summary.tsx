"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { h4Class } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * OrderSummary — 注文サマリー枠 (Figma【R2: 確定版】カート 変A /
 * PC `OrderSummary` 6684:163 / SP 6686:14228)。
 *
 * Figma 実測 (px) → 実装:
 * - 枠      PC w360 / p24、SP w100% / p20、radius 8 (`radius-lg`)、border 1
 *           (`border`)、bg `card`                → `w-full p-5 lg:w-90 lg:p-6`
 *                                                 `rounded-lg border border-border bg-card`
 * - 内側 gap 16                                  → `gap-4`
 * - 見出し「注文サマリー」 14/500 (`jp/h5`)      → `<h2 data-slot="summary-title">`
 *   (体裁は globals.css の `h2[data-slot="summary-title"]` で h5 プリセットに束縛)
 * - 小計行  ラベル `muted-foreground` / 値 `foreground`、いずれも 16/400 (`jp/body`)
 *           → body は `<body>` から継承するので追加クラス不要 (色だけ指定)
 * - 罫線    h1 / `border`                        → DS `Separator`
 * - 合計行  ラベル 16/400 `foreground` / 値 16/500 (`jp/h4`)
 * - ボタン  bg `primary` / radius 6 / px24 py12 / 14-500 `primary-foreground`
 *           → DS `Button` (既定 variant)。高さは Figma 45 = 21(lh1.5) + 12*2 なので
 *             `h-auto px-6 py-3 leading-normal` で行高 1.5 を明示する
 *
 * DS `Card` を使わない理由: `Card` は `rounded-xl` / `shadow-sm` / `gap-6` / `py-6` を
 * 前提に組まれており、Figma の枠 (radius 8 / 影なし / gap 16 / 全周 24) とは 4 項目が
 * 食い違う。全部 override すると `Card` を使う意味が無くなるうえ、Figma 側も DS Card の
 * instance ではなく素の frame なので、専用部品として組む。
 *
 * 生 px / 生カラーは書かない。
 */
export type OrderSummaryProps = {
  /** i18n "注文サマリー"。 */
  heading: string;
  /** i18n "小計"。 */
  subtotalLabel: string;
  /** 整形済み小計。 */
  subtotal: string;
  /** i18n "合計"。 */
  totalLabel: string;
  /** 整形済み合計。 */
  total: string;
  /** i18n "購入手続きへ"。 */
  checkoutLabel: string;
  /** Shopify checkoutUrl。外部遷移なので `<a>` (Link ではない)。 */
  checkoutUrl: string;
  onCheckout?: () => void;
  className?: string;
};

export function OrderSummary({
  heading,
  subtotalLabel,
  subtotal,
  totalLabel,
  total,
  checkoutLabel,
  checkoutUrl,
  onCheckout,
  className,
}: OrderSummaryProps) {
  return (
    <div
      data-slot="order-summary"
      className={cn(
        "border-border bg-card flex w-full flex-col gap-4 rounded-lg border p-5 lg:w-90 lg:shrink-0 lg:p-6",
        className,
      )}
    >
      <h2 data-slot="summary-title" className="text-foreground">
        {heading}
      </h2>

      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground">{subtotalLabel}</p>
        <p className="text-foreground">{subtotal}</p>
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4">
        <p className="text-foreground">{totalLabel}</p>
        <p className={cn(h4Class, "text-foreground")}>{total}</p>
      </div>

      <Button asChild className="h-auto w-full px-6 py-3 leading-normal">
        <a href={checkoutUrl} onClick={onCheckout}>
          {checkoutLabel}
        </a>
      </Button>
    </div>
  );
}
