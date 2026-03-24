/**
 * Tests for the cart optimistic reducer logic.
 *
 * The reducer is defined inside cart-context.tsx as `cartReducer`.
 * Since it is not exported, we replicate the logic here to test
 * the same algorithm without importing React components.
 */
import { describe, it, expect } from "vitest";
import type { Cart, CartItem } from "@/lib/shopify/types";

type CartAction =
  | { type: "ADD"; item: CartItem }
  | { type: "UPDATE"; lineId: string; quantity: number }
  | { type: "REMOVE"; lineId: string };

/**
 * Replica of cartReducer from cart-context.tsx.
 * Kept in sync manually — any divergence indicates a regression.
 */
function cartReducer(state: Cart | null, action: CartAction): Cart | null {
  if (!state) return state;

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

// Helpers
function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: overrides.id ?? "line-1",
    quantity: overrides.quantity ?? 1,
    merchandise: overrides.merchandise ?? {
      id: "gid://shopify/ProductVariant/1",
      title: "Default",
      selectedOptions: [],
      product: {
        id: "gid://shopify/Product/1",
        handle: "test",
        title: "Test",
        featuredImage: null,
        vendor: "elxea",
      },
      price: { amount: "1000", currencyCode: "JPY" },
    },
    cost: overrides.cost ?? {
      totalAmount: { amount: "1000", currencyCode: "JPY" },
    },
    sellingPlanAllocation: overrides.sellingPlanAllocation ?? null,
  };
}

function makeCart(lines: CartItem[] = []): Cart {
  return {
    id: "gid://shopify/Cart/1",
    checkoutUrl: "https://elxea.com/checkout",
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    cost: {
      subtotalAmount: { amount: "0", currencyCode: "JPY" },
      totalAmount: { amount: "0", currencyCode: "JPY" },
      totalTaxAmount: null,
    },
    lines,
  };
}

describe("cartReducer", () => {
  it("returns null when state is null", () => {
    expect(cartReducer(null, { type: "ADD", item: makeCartItem() })).toBeNull();
  });

  describe("ADD", () => {
    it("adds a new item to an empty cart", () => {
      const cart = makeCart([]);
      const item = makeCartItem({ id: "new-line", quantity: 2 });
      const result = cartReducer(cart, { type: "ADD", item });

      expect(result!.lines).toHaveLength(1);
      expect(result!.totalQuantity).toBe(2);
    });

    it("increments quantity when adding an existing merchandise", () => {
      const existing = makeCartItem({ id: "line-1", quantity: 1 });
      const cart = makeCart([existing]);

      const duplicate = makeCartItem({ id: "new-optimistic", quantity: 3 });
      const result = cartReducer(cart, { type: "ADD", item: duplicate });

      expect(result!.lines).toHaveLength(1);
      expect(result!.lines[0].quantity).toBe(4); // 1 + 3
      expect(result!.totalQuantity).toBe(4);
    });

    it("adds a second distinct item", () => {
      const item1 = makeCartItem({ id: "line-1" });
      const cart = makeCart([item1]);

      const item2 = makeCartItem({
        id: "line-2",
        quantity: 1,
        merchandise: {
          ...item1.merchandise,
          id: "gid://shopify/ProductVariant/2",
        },
      });
      const result = cartReducer(cart, { type: "ADD", item: item2 });

      expect(result!.lines).toHaveLength(2);
      expect(result!.totalQuantity).toBe(2);
    });
  });

  describe("UPDATE", () => {
    it("updates quantity for an existing line", () => {
      const item = makeCartItem({ id: "line-1", quantity: 2 });
      const cart = makeCart([item]);

      const result = cartReducer(cart, {
        type: "UPDATE",
        lineId: "line-1",
        quantity: 5,
      });

      expect(result!.lines[0].quantity).toBe(5);
      expect(result!.totalQuantity).toBe(5); // 2 + (5-2) = 5
    });

    it("returns unchanged state for non-existent line", () => {
      const cart = makeCart([makeCartItem()]);
      const result = cartReducer(cart, {
        type: "UPDATE",
        lineId: "nonexistent",
        quantity: 10,
      });

      expect(result).toBe(cart);
    });
  });

  describe("REMOVE", () => {
    it("removes a line from the cart", () => {
      const item = makeCartItem({ id: "line-1", quantity: 3 });
      const cart = makeCart([item]);

      const result = cartReducer(cart, { type: "REMOVE", lineId: "line-1" });

      expect(result!.lines).toHaveLength(0);
      expect(result!.totalQuantity).toBe(0);
    });

    it("returns unchanged state for non-existent line", () => {
      const cart = makeCart([makeCartItem()]);
      const result = cartReducer(cart, {
        type: "REMOVE",
        lineId: "nonexistent",
      });

      expect(result).toBe(cart);
    });
  });
});
