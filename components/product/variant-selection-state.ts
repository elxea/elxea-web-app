/**
 * バリエーション選択 (サイズ / タイプ / 種類) の**規則そのもの**。
 *
 * ここは React に依存しない純関数だけを置く。狙いは 2 つ。
 *
 * 1. 画面側 (`variant-selection-context.tsx`) と テスト
 *    (`__tests__/variant-selection.test.ts`) が**同じ 1 本の規則**を読むこと。
 *    規則をテスト側に書き写すと、写しごと間違えたときに緑のまま本番だけ壊れる
 *    (Wave A の `cart-reducer` で実際に起きた: 旧テストが規則の写しを持ち、
 *    写しにも同じ不具合が書かれていた)。
 * 2. 選択の解決を**クライアントだけで完結**させること。以前はどの変種が選ばれた
 *    かをサーバコンポーネントが URL クエリから計算していたので、選択のたびに
 *    サーバ往復 (RSC 再取得) が必要だった。規則がここにあれば、押した瞬間に
 *    ブラウザ側で価格まで含めて確定できる。
 */
import type { ProductVariant } from "@/lib/shopify/types";

/** 商品オプション 1 つ (例: name="サイズ", values=["XS (3袋)", "S (6袋)"])。 */
export type ProductOption = { id: string; name: string; values: string[] };

/** 現在の選択。キーはオプション名、値は選ばれた値。未選択のオプションは持たない。 */
export type VariantSelection = Record<string, string>;

/**
 * URL クエリから初期選択を読む。**初回表示 (SSR / 深いリンク) 専用**。
 *
 * 値が実在するかを `option.values` で照合する。照合しないと `?サイズ=xxx` の
 * ような手書きの値がそのまま選択として残り、どのボタンも光らないのに
 * 「選択済み」の扱いになる。
 */
export function readSelectionFromParams(
  options: ProductOption[],
  params: Record<string, string | string[] | undefined>
): VariantSelection {
  const selection: VariantSelection = {};
  for (const option of options) {
    const raw = params[option.name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && option.values.includes(value)) {
      selection[option.name] = value;
    }
  }
  return selection;
}

/** 1 つのオプションを選び直した新しい選択を返す (元の選択は変更しない)。 */
export function applySelection(
  previous: VariantSelection,
  name: string,
  value: string
): VariantSelection {
  return { ...previous, [name]: value };
}

/**
 * 選択から表示すべき変種を決める。
 *
 * 全オプションが揃って一致した変種を返し、揃っていなければ先頭の変種に落とす。
 * この「落とし方」は元のサーバ側の計算と同じにしてある。ここを変えると、
 * 初回表示 (サーバ) と操作後 (クライアント) で違う価格が出る。
 */
export function resolveSelectedVariant(
  variants: ProductVariant[],
  selection: VariantSelection
): ProductVariant | undefined {
  const exact = variants.find((variant) =>
    variant.selectedOptions.every((option) => selection[option.name] === option.value)
  );
  return exact ?? variants[0];
}

/**
 * その値を選んだとき、購入できる変種が 1 つでも残るか。
 *
 * 「他のオプションの現在の選択 + いま検討している値」で在庫のある変種を探す。
 * 未選択のオプションは条件に入れない (まだ絞り込まれていないため)。
 */
export function isOptionAvailable(
  options: ProductOption[],
  variants: ProductVariant[],
  selection: VariantSelection,
  name: string,
  value: string
): boolean {
  const candidate: VariantSelection = {};
  for (const option of options) {
    const selected = selection[option.name];
    if (selected) candidate[option.name] = selected;
  }
  candidate[name] = value;

  return variants.some(
    (variant) =>
      variant.availableForSale &&
      variant.selectedOptions.every(
        (option) => !candidate[option.name] || candidate[option.name] === option.value
      )
  );
}

/**
 * 選択を URL クエリ文字列に写す。
 *
 * URL 同期は**見た目を変えた後の後追い**であって、選択状態の正本ではない
 * (正本は React の state)。共有・再読み込み・戻る操作のためだけに保つ。
 */
export function selectionToSearchParams(
  selection: VariantSelection,
  base?: URLSearchParams
): URLSearchParams {
  const params = new URLSearchParams(base ? base.toString() : undefined);
  for (const [name, value] of Object.entries(selection)) {
    params.set(name, value);
  }
  return params;
}
