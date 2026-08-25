"use client";

import {
  createContext,
  useContext,
  useOptimistic,
  useTransition,
  type ReactNode,
} from "react";
import type { Cart } from "@/lib/shopify/types";
import { addItem, updateItem, removeItem } from "@/lib/shopify/cart-actions";
import { cartReducer, type CartAction } from "./cart-reducer";

/** 書き込みが着地したかどうか。呼び出し側がその場で知らせ分けるために返す。 */
export type CartWriteOutcome = "ok" | "failed";

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

export function CartProvider({
  children,
  initialCart,
}: {
  children: ReactNode;
  initialCart: Cart | null;
}) {
  const [optimisticCart, setOptimisticCart] = useOptimistic(
    initialCart,
    cartReducer
  );
  const [isPending, startTransition] = useTransition();

  /**
   * 「先に画面を書き換え、そのあとサーバへ送る」を 1 つの遷移にまとめる。
   *
   * `startTransition` は戻り値を返さないので、着地は別の Promise で渡す。
   * こうしておくと呼び出し側は**押した瞬間に知らせを出し**、ここが `failed` を
   * 返したときだけ言い直せる — 成功を待ってから知らせる作りだと、1 個目の
   * 追加では知らせ自体が 8.9 秒遅れて出ていた (監査 P1-1)。
   */
  function write(
    optimistic: CartAction,
    send: () => Promise<unknown>,
  ): Promise<CartWriteOutcome> {
    return new Promise<CartWriteOutcome>((resolve) => {
      startTransition(async () => {
        setOptimisticCart(optimistic);
        try {
          await send();
          resolve("ok");
        } catch (e) {
          console.error("Cart write failed:", e);
          resolve("failed");
        }
      });
    });
  }

  function handleAddToCart(merchandiseId: string, quantity = 1, sellingPlanId?: string) {
    return write(
      {
        type: "ADD",
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
      },
      () => addItem(merchandiseId, quantity, sellingPlanId),
    );
  }

  function handleUpdateQuantity(
    lineId: string,
    merchandiseId: string,
    quantity: number
  ) {
    return write(
      quantity === 0
        ? { type: "REMOVE", lineId }
        : { type: "UPDATE", lineId, quantity },
      () => updateItem(lineId, merchandiseId, quantity),
    );
  }

  function handleRemoveFromCart(lineId: string) {
    return write({ type: "REMOVE", lineId }, () => removeItem(lineId));
  }

  return (
    <CartContext.Provider
      value={{
        cart: optimisticCart,
        isPending,
        addToCart: handleAddToCart,
        updateQuantity: handleUpdateQuantity,
        removeFromCart: handleRemoveFromCart,
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
