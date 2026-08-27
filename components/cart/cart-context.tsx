"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { Cart, CartItem } from "@/lib/shopify/types";
import { addItem, updateItem, removeItem } from "@/lib/shopify/cart-actions";
import { cartReducer } from "./cart-reducer";
import { useOptimisticMutation } from "@/lib/interaction/use-optimistic-mutation";
import type { WriteMode, WriteOutcome } from "@/lib/interaction/write-queue";

/** 書き込みが着地したかどうか。呼び出し側がその場で知らせ分けるために返す。 */
export type CartWriteOutcome = WriteOutcome;

/**
 * カートへの申し込み。**画面の書き換え方と送り先を 1 つの値にまとめる**。
 *
 * `cartReducer` は `type` / `item` / `lineId` / `quantity` だけを見るので、
 * ここに送信用の項目 (`merchandiseId` など) を足しても楽観更新の規則は変わらない
 * (構造的に `CartAction` として通る)。
 */
type CartInput =
  | { type: "ADD"; item: CartItem; merchandiseId: string; sellingPlanId?: string }
  | { type: "UPDATE"; lineId: string; merchandiseId: string; quantity: number }
  | { type: "REMOVE"; lineId: string };

type CartContextType = {
  cart: Cart | null;
  isPending: boolean;
  addToCart: (
    merchandiseId: string,
    quantity?: number,
    sellingPlanId?: string,
  ) => Promise<CartWriteOutcome>;
  updateQuantity: (
    lineId: string,
    merchandiseId: string,
    quantity: number,
  ) => Promise<CartWriteOutcome>;
  removeFromCart: (lineId: string) => Promise<CartWriteOutcome>;
};

const CartContext = createContext<CartContextType | null>(null);

/**
 * 連打をどう捌くか。**送る値の性質で決まる** (`write-queue` の表を参照)。
 *
 * - 数量と削除は**絶対量**なので `"latest"`。5 連打しても往復は最大 2 本で、
 *   最後に送られるのは必ず最新の数量。
 * - 追加は**加算**なので `"all"`。ここを `"latest"` にすると「カートに追加」を
 *   3 回押したのに 1 個しか入らない、という取りこぼしになる。
 */
function modeFor(input: CartInput): WriteMode {
  return input.type === "ADD" ? "all" : "latest";
}

/**
 * 連打をまとめる単位。
 *
 * 同じ行への数量変更と削除は同じ鍵にして直列化する (削除が数量変更を追い越すと、
 * 消したはずの行が戻ってくる)。追加は変種ごとに 1 本の列にする — カートがまだ
 * 無いときの `cartCreate` が同時に 2 本走ると、カートが 2 つ出来て片方の商品が
 * 消えるため。
 */
function keyFor(input: CartInput): string {
  return input.type === "ADD" ? `add:${input.merchandiseId}` : `line:${input.lineId}`;
}

export function CartProvider({
  children,
  initialCart,
}: {
  children: ReactNode;
  initialCart: Cart | null;
}) {
  /**
   * サーバへ送る。**絶対量 / 加算の区別は `modeFor` 側が持つ**ので、ここは
   * 申し込みをそのまま対応する Server Action に流すだけ。
   */
  const send = useCallback((input: CartInput) => {
    switch (input.type) {
      case "ADD":
        return addItem(input.merchandiseId, input.item.quantity, input.sellingPlanId);
      case "UPDATE":
        return updateItem(input.lineId, input.merchandiseId, input.quantity);
      case "REMOVE":
        return removeItem(input.lineId);
    }
  }, []);

  /**
   * 失敗したときの言い直しは**呼び出し側の画面**が出す (文言が場所ごとに違い、
   * i18n の辞書も画面側にあるため)。ここは `run` の戻り値で成否を渡すだけに留め、
   * 共通機構の「黙って戻さない」という約束は各画面が `failed` を見て果たす。
   */
  const noop = useCallback(() => {}, []);

  const cart = useOptimisticMutation<Cart | null, CartInput>({
    operation: "cart.write",
    value: initialCart,
    reduce: cartReducer,
    send,
    keyOf: keyFor,
    mode: modeFor,
    onFailure: noop,
  });

  const addToCart = useCallback(
    (merchandiseId: string, quantity = 1, sellingPlanId?: string) =>
      cart.run({
        type: "ADD",
        merchandiseId,
        sellingPlanId,
        item: {
          id: `optimistic-${Date.now()}`,
          quantity,
          merchandise: {
            id: merchandiseId,
            title: "",
            selectedOptions: [],
            product: { id: "", handle: "", title: "", featuredImage: null, vendor: "" },
            price: { amount: "0", currencyCode: "JPY" },
          },
          cost: { totalAmount: { amount: "0", currencyCode: "JPY" } },
          sellingPlanAllocation: null,
        },
      }),
    [cart],
  );

  const updateQuantity = useCallback(
    (lineId: string, merchandiseId: string, quantity: number) =>
      /* 0 は「削除」。画面の書き換えも送り先も削除に寄せる。 */
      quantity === 0
        ? cart.run({ type: "REMOVE", lineId })
        : cart.run({ type: "UPDATE", lineId, merchandiseId, quantity }),
    [cart],
  );

  const removeFromCart = useCallback(
    (lineId: string) => cart.run({ type: "REMOVE", lineId }),
    [cart],
  );

  return (
    <CartContext.Provider
      value={{
        cart: cart.value,
        isPending: cart.isPending,
        addToCart,
        updateQuantity,
        removeFromCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
