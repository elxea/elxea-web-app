"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { ProductVariant } from "@/lib/shopify/types";

import {
  applySelection,
  isOptionAvailable,
  resolveSelectedVariant,
  selectionToSearchParams,
  type ProductOption,
  type VariantSelection,
} from "./variant-selection-state";

/**
 * 商品詳細のバリエーション選択を**ブラウザ側で保持する**入れ物。
 *
 * ## なぜこれが要るか (2026-08-26 / 体感品質)
 *
 * 以前は選択の正本が URL クエリで、`VariantSelector` が `useSearchParams()` を
 * 読んで光らせていた。押すと `router.replace()` が走り、それは Next.js の
 * ナビゲーション = **サーバ往復 (`?_rsc=` の再取得)** なので、選択の枠が付くのは
 * サーバが商品ページを描き直して返ってきた後だった。本番 SP390 の実測で
 * 押してから見た目が変わるまで中央値 373ms・初回 1,187ms (しかも 1 タップにつき
 * `_rsc` が 2 本飛んでいた)。電波の悪い実機ではこれが体感で「反応しない」になる。
 *
 * 直し方は「選択の正本を state に移す」こと。押した瞬間に state が変わるので、
 * 枠も価格もカート投入先の変種も次の描画で決まる (サーバを待たない)。URL は
 * `history.replaceState` で**後から**揃える。`router.replace` ではなく履歴 API を
 * 直接使うのが要点で、これならアドレス欄と共有リンクは正しく保ったまま
 * RSC の再取得が起きない (Next.js は history API を patch していて、
 * ルータの内部状態も合わせて更新される)。
 *
 * 価格や購入ボタンも同じ入れ物から読む。ここを見ずにサーバが描いた変種を使うと、
 * 枠だけ即座に動いて価格が往復ぶん遅れて付いてくる、という別のちぐはぐになる。
 */
type VariantSelectionValue = {
  /** 現在の選択 (未選択のオプションは持たない)。 */
  selection: VariantSelection;
  /** 選択から決まる変種。価格・在庫・カート投入先はすべてこれを見る。 */
  selectedVariant: ProductVariant | undefined;
  /** 1 つ選び直す。見た目は即時、URL は後追い。 */
  select: (name: string, value: string) => void;
  isSelected: (name: string, value: string) => boolean;
  isAvailable: (name: string, value: string) => boolean;
};

const VariantSelectionContext = createContext<VariantSelectionValue | null>(null);

export function useVariantSelection(): VariantSelectionValue {
  const value = useContext(VariantSelectionContext);
  if (!value) {
    throw new Error(
      "useVariantSelection は VariantSelectionProvider の中でしか使えない"
    );
  }
  return value;
}

export function VariantSelectionProvider({
  options,
  variants,
  initialSelection,
  children,
}: {
  options: ProductOption[];
  variants: ProductVariant[];
  /**
   * 初回表示の選択。サーバが URL クエリから
   * `readSelectionFromParams` で作って渡す。サーバとクライアントで同じ規則を
   * 使うので、hydration で食い違わない。
   */
  initialSelection: VariantSelection;
  children: React.ReactNode;
}) {
  const [selection, setSelection] = useState<VariantSelection>(initialSelection);

  /**
   * 選択を 1 つ変える。**必ず直前の選択 (`previous`) を土台にする**。
   *
   * 土台を外側の `selection` から読む書き方 (`applySelection(selection, ...)`)
   * にすると、同じ tick に 2 回押されたとき 2 回目が古い土台から計算され、
   * 1 回目が消える。実測で確認済み: S+ティーバッグ から「XS」「フルリーフ」を
   * 続けて押すと ¥1,480 になるべきところ ¥2,462 (サイズが S のまま) になった。
   * 人の指では起きにくいが、連打・自動操作では起きる。
   */
  const select = useCallback((name: string, value: string) => {
    setSelection((previous) => applySelection(previous, name, value));
  }, []);

  /**
   * URL 同期は**描画が確定してから**の後追い。
   *
   * `router.replace` を使うとサーバ往復に戻ってしまうので履歴 API を直接叩く。
   * 共有リンクと再読み込みのためだけの写しで、選択の正本ではない。
   * 初回表示のように URL と選択が既に一致しているときは何もしない。
   */
  useEffect(() => {
    const url = new URL(window.location.href);
    const nextSearch = selectionToSearchParams(selection, url.searchParams).toString();
    if (nextSearch === url.searchParams.toString()) return;
    url.search = nextSearch;
    window.history.replaceState(null, "", url);
  }, [selection]);

  const selectedVariant = useMemo(
    () => resolveSelectedVariant(variants, selection),
    [variants, selection]
  );

  const isSelected = useCallback(
    (name: string, value: string) => selection[name] === value,
    [selection]
  );

  const isAvailable = useCallback(
    (name: string, value: string) =>
      isOptionAvailable(options, variants, selection, name, value),
    [options, variants, selection]
  );

  const value = useMemo(
    () => ({ selection, selectedVariant, select, isSelected, isAvailable }),
    [selection, selectedVariant, select, isSelected, isAvailable]
  );

  return (
    <VariantSelectionContext.Provider value={value}>
      {children}
    </VariantSelectionContext.Provider>
  );
}
