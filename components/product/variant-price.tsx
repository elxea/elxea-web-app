"use client";

import { formatPrice } from "@/lib/utils";

import { useVariantSelection } from "./variant-selection-context";

/**
 * 選択中の変種の価格。
 *
 * 以前はサーバコンポーネントが URL クエリから変種を決めて描いていたため、
 * サイズやタイプを押しても価格だけはサーバ往復ぶん遅れて追いついてきた。
 * 選択と同じ入れ物から読むことで、枠と価格が同じ描画で一緒に変わる。
 */
export function VariantPrice({ className }: { className?: string }) {
  const { selectedVariant } = useVariantSelection();
  if (!selectedVariant) return null;

  return (
    <p className={className}>
      {formatPrice(selectedVariant.price.amount, selectedVariant.price.currencyCode)}
    </p>
  );
}
