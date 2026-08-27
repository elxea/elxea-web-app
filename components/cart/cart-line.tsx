"use client";

import * as React from "react";

import { ImageCard } from "@/components/media/image-card";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { bodySmClass, h5Class } from "@/components/editorial/rule-list";
import { cn } from "@/lib/utils";

/**
 * CartLine — カート 1 行 (Figma【R2: 確定版】カート 変A / PC `CartLine` 6684:124 /
 * SP `CartItemSP` 6686:14186)。
 *
 * PC と SP で「同じ部品が並び替わる」構造なので、**1 つの DOM を CSS Grid で
 * 置き換える**（`hidden` / `lg:hidden` の二重描画をしない）。Figma の
 * ctrl は PC では info の 4 番目の子だが、grid では info の隣 (行 2 / 列 2) に置く。
 * 列 2 の左端 = info の左端なので描画位置は Figma と同一で、SP では ctrl だけを
 * 列 1-2 に跨がせて下段へ落とせる。
 *
 * 配置 (Figma 実測 → grid):
 *
 * | | 列 1 | 列 2 | 列 3 |
 * |---|---|---|---|
 * | 行 1 | 写真 | info (タイトル/内容量/定期便) | 価格 |
 * | 行 2 | ctrl (数量 + 削除) | 〃 | 〃 |
 *
 * - SP 390: 列 = `24*4px(96)` / `1fr` / `auto`、gap-x 16 / gap-y 12
 *   → 写真 96、info は 列2+列3 を跨いで 238 (Figma 238)、
 *     ctrl は 列1+列2 を跨いで左端 x0 (Figma lc x=0 w=133)、価格は x=303 (Figma 303)
 * - PC 1440: 列 = `35*4px(140)` / `1fr` / `auto`、gap-x 20 / gap-y 8
 *   → 写真 140 (行 1-2)、info 640 (Figma 640)、価格 x=820 (Figma 820 / 行 1-2)
 * - 行の上下余白 24 (Figma CartLine py-24)。SP は先頭/末尾の余白なし
 *   (Figma SP CartItems は gap-24 + 罫線で、行自身に padding を持たない)
 *
 * 配置は `col-start-*` / `col-end-*` / `row-start-*` / `row-end-*` だけで書く。
 * `col-span-*` / `row-span-*` は `grid-column: span N / span N` の**一括指定**なので
 * `grid-column-start` を巻き戻し、CSS の出力順次第で col-start が無効化される
 * (2026-08-08 の初回実装で info が列 1 に落ちる不具合を実測した)。span は使わない。
 *
 * 文字組み:
 * - タイトル / 行合計  SP `h5` (14/500) → PC `h4` (16/500)
 * - 内容量 / 定期便 / 単価 / 削除  `body-sm` (14/400) + `muted-foreground`
 *
 * 生 px / 生カラーは書かない。寸法は Tailwind spacing scale (= spacing.* トークン)、
 * 色は semantic token、文字組みは `typography.style.*` トークン。
 */

/** SP は h5 (14/500)、PC は h4 (16/500)。Figma のタイトル/行合計と同じ切替。 */
const TITLE_SCALE = cn(
  h5Class,
  "lg:[font:var(--typography-style-h4)] lg:[letter-spacing:var(--typography-style-h4-tracking)]",
);

export type CartLineProps = {
  /** 商品写真 URL。未設定なら ImageCard の placeholder。 */
  imageUrl?: string;
  imageAlt?: string;
  title: string;
  /** 内容量など selectedOptions 由来の 1 行 (例 "内容量: 100g")。 */
  variantLabel?: string | null;
  /** 定期便ラベル (例 "定期便: 毎月1回お届け")。通常購入では null。 */
  planLabel?: string | null;
  /** 単価 (整形済み文字列)。 */
  unitPrice: string;
  /** 行合計 (整形済み文字列)。 */
  linePrice: string;
  quantity: number;
  onQuantityChange: (next: number) => void;
  onRemove: () => void;
  disabled?: boolean;
  /** i18n "数量"。 */
  quantityLabel: string;
  /** i18n "削除"。 */
  removeLabel: string;
  className?: string;
};

export function CartLine({
  imageUrl,
  imageAlt,
  title,
  variantLabel,
  planLabel,
  unitPrice,
  linePrice,
  quantity,
  onQuantityChange,
  onRemove,
  disabled,
  quantityLabel,
  removeLabel,
  className,
}: CartLineProps) {
  return (
    <li
      data-slot="cart-line"
      className={cn(
        "grid grid-cols-[calc(var(--spacing)*24)_1fr_auto] gap-x-4 gap-y-3 py-6 first:pt-0 last:pb-0",
        "lg:grid-cols-[calc(var(--spacing)*35)_1fr_auto] lg:gap-x-5 lg:gap-y-2 lg:first:pt-6 lg:last:pb-6",
        className,
      )}
    >
      <ImageCard
        image={imageUrl}
        alt={imageAlt ?? title}
        aspectRatio="3/2"
        width={280}
        height={188}
        sizes="(min-width: 64rem) 140px, 96px"
        className="col-start-1 col-end-2 row-start-1 row-end-2 w-full self-start lg:row-end-3"
      />

      <div
        data-slot="cart-line-info"
        className="col-start-2 col-end-4 row-start-1 row-end-2 flex min-w-0 flex-col gap-1 lg:col-end-3 lg:gap-2"
      >
        <p className={cn(TITLE_SCALE, "text-foreground")}>{title}</p>
        {variantLabel ? (
          <p className={cn(bodySmClass, "text-muted-foreground")}>{variantLabel}</p>
        ) : null}
        {planLabel ? (
          <p className={cn(bodySmClass, "text-muted-foreground")}>{planLabel}</p>
        ) : null}
      </div>

      <div
        data-slot="cart-line-ctrl"
        className="col-start-1 col-end-3 row-start-2 row-end-3 flex items-center gap-4 lg:col-start-2 lg:col-end-3"
      >
        <QuantityStepper
          value={quantity}
          onChange={onQuantityChange}
          disabled={disabled}
          label={quantityLabel}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className={cn(
            bodySmClass,
            "text-muted-foreground hover:text-foreground underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {removeLabel}
        </button>
      </div>

      <div
        data-slot="cart-line-price"
        className="col-start-3 col-end-4 row-start-2 row-end-3 flex flex-col items-end text-right lg:row-start-1 lg:row-end-3 lg:gap-1 lg:self-start"
      >
        <p className={cn(bodySmClass, "text-muted-foreground")}>{unitPrice}</p>
        {/* `cart-line-total` は台帳 (`interaction-inventory.json`) の `observe` から
            名指しされる。数量を押したときに**この行が更新完了するまで**が検査対象で、
            ここが古いままだと e2e が落ちる。名前を変えるなら台帳も一緒に直す。 */}
        <p data-slot="cart-line-total" className={cn(TITLE_SCALE, "text-foreground")}>
          {linePrice}
        </p>
      </div>
    </li>
  );
}
