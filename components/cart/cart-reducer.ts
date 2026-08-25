import type { Cart, CartItem } from "@/lib/shopify/types";

/**
 * カートの楽観更新の規則。**画面から切り離してここに置く**。
 *
 * 以前はこの関数が `cart-context.tsx` の中にあり、テストは同じ内容を
 * 「手で同期する複製」として持っていた (`__tests__/cart-reducer.test.ts` の
 * 旧コメント: "Kept in sync manually")。複製はずれる。実際、**カートがまだ
 * 無いときに ADD を捨てる**という不具合は複製側にも同じように書かれていたので、
 * テストは通ったまま本番だけが 8.9 秒無言になっていた (監査 P1-1)。
 *
 * 1 つの実体を両方から読むようにして、その形の見落としを起こせなくする。
 */

export type CartAction =
  | { type: "ADD"; item: CartItem }
  | { type: "UPDATE"; lineId: string; quantity: number }
  | { type: "REMOVE"; lineId: string };

/**
 * まだサーバ側にカートが無いときの**仮のカート**。
 *
 * 1 個目を入れる操作は Shopify の `cartCreate` を伴うので、応答までに本番実測で
 * 8.9 秒かかっていた。その間 `state` は null で、`if (!state) return state` が
 * 楽観更新をまるごと捨てていたため、**画面はどこも変わらなかった** —
 * ヘッダーのバッジすら動かない。
 *
 * 仮のカートを立ててから ADD を適用すれば、1 個目もその場でバッジが動く。
 * `id` / `checkoutUrl` は空にしてある: 決済へ進む導線はカートページが
 * サーバの本物のカートから描くので、仮の値が決済に使われることはない。
 * サーバの応答が届いた時点で React がこの仮の状態を破棄する。
 */
export const PENDING_CART: Cart = {
  id: "",
  checkoutUrl: "",
  totalQuantity: 0,
  cost: {
    subtotalAmount: { amount: "0", currencyCode: "JPY" },
    totalAmount: { amount: "0", currencyCode: "JPY" },
    totalTaxAmount: null,
  },
  lines: [],
};

export function cartReducer(current: Cart | null, action: CartAction): Cart | null {
  /* ADD だけは「カートがまだ無い」状態から始まりうる。UPDATE / REMOVE は
     既にある行を指しているので、カートが無ければ何もしないままでよい。 */
  if (!current && action.type !== "ADD") return current;
  const state = current ?? PENDING_CART;

  switch (action.type) {
    case "ADD": {
      const existingLine = state.lines.find(
        (l) => l.merchandise.id === action.item.merchandise.id,
      );
      if (existingLine) {
        return {
          ...state,
          totalQuantity: state.totalQuantity + action.item.quantity,
          lines: state.lines.map((l) =>
            l.id === existingLine.id
              ? { ...l, quantity: l.quantity + action.item.quantity }
              : l,
          ),
        };
      }
      return {
        ...state,
        totalQuantity: state.totalQuantity + action.item.quantity,
        lines: [...state.lines, action.item],
      };
    }
    case "UPDATE": {
      const line = state.lines.find((l) => l.id === action.lineId);
      if (!line) return state;
      const diff = action.quantity - line.quantity;
      return {
        ...state,
        totalQuantity: state.totalQuantity + diff,
        lines: state.lines.map((l) =>
          l.id === action.lineId ? { ...l, quantity: action.quantity } : l,
        ),
      };
    }
    case "REMOVE": {
      const removedLine = state.lines.find((l) => l.id === action.lineId);
      if (!removedLine) return state;
      return {
        ...state,
        totalQuantity: state.totalQuantity - removedLine.quantity,
        lines: state.lines.filter((l) => l.id !== action.lineId),
      };
    }
    default:
      return state;
  }
}
