"use client";

import {
  createContext,
  useContext,
  useOptimistic,
  useTransition,
  type ReactNode,
} from "react";
import type { Cart, CartItem } from "@/lib/shopify/types";
import { addItem, updateItem, removeItem } from "@/lib/shopify/cart-actions";

type CartAction =
  | { type: "ADD"; item: CartItem }
  | { type: "UPDATE"; lineId: string; quantity: number }
  | { type: "REMOVE"; lineId: string };

type CartContextType = {
  cart: Cart | null;
  isPending: boolean;
  addToCart: (merchandiseId: string, quantity?: number, sellingPlanId?: string) => Promise<void>;
  updateQuantity: (lineId: string, merchandiseId: string, quantity: number) => Promise<void>;
  removeFromCart: (lineId: string) => Promise<void>;
};

const CartContext = createContext<CartContextType | null>(null);

function cartReducer(state: Cart | null, action: CartAction): Cart | null {
  if (!state) return state;

  switch (action.type) {
    case "ADD": {
      const existingLine = state.lines.find(
        (l) => l.merchandise.id === action.item.merchandise.id
      );
      if (existingLine) {
        return {
          ...state,
          totalQuantity: state.totalQuantity + action.item.quantity,
          lines: state.lines.map((l) =>
            l.id === existingLine.id
              ? { ...l, quantity: l.quantity + action.item.quantity }
              : l
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
          l.id === action.lineId ? { ...l, quantity: action.quantity } : l
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

  async function handleAddToCart(merchandiseId: string, quantity = 1, sellingPlanId?: string) {
    startTransition(async () => {
      setOptimisticCart({
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
      });
      try {
        await addItem(merchandiseId, quantity, sellingPlanId);
      } catch (e) {
        console.error("Failed to add to cart:", e);
      }
    });
  }

  async function handleUpdateQuantity(
    lineId: string,
    merchandiseId: string,
    quantity: number
  ) {
    startTransition(async () => {
      if (quantity === 0) {
        setOptimisticCart({ type: "REMOVE", lineId });
      } else {
        setOptimisticCart({ type: "UPDATE", lineId, quantity });
      }
      try {
        await updateItem(lineId, merchandiseId, quantity);
      } catch (e) {
        console.error("Failed to update cart:", e);
      }
    });
  }

  async function handleRemoveFromCart(lineId: string) {
    startTransition(async () => {
      setOptimisticCart({ type: "REMOVE", lineId });
      try {
        await removeItem(lineId);
      } catch (e) {
        console.error("Failed to remove from cart:", e);
      }
    });
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
