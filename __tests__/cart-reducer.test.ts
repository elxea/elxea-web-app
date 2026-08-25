/**
 * カートの楽観更新の規則のテスト。
 *
 * **実体をそのまま読む** (`components/cart/cart-reducer.ts`)。以前はここに同じ
 * 規則の写しを置き「手で同期する」運用にしていたが、写しは実体と一緒にずれる。
 * 実際「カートがまだ無いときの 1 個目」を捨てる不具合は写しにも同じように
 * 書かれていたので、テストは緑のまま本番だけが 8.9 秒無言だった (監査 P1-1)。
 */
import { describe, it, expect } from "vitest";
import type { Cart, CartItem } from "@/lib/shopify/types";
import { cartReducer } from "@/components/cart/cart-reducer";

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
  describe("カートがまだ無いとき (初回追加)", () => {
    it("1 個目でも数が増える (サーバの応答を待たない)", () => {
      /* 監査 P1-1 の回帰テスト。ここが null を返していたので、1 個目だけ
         楽観更新が丸ごと捨てられ、ヘッダーのバッジが 8.9 秒動かなかった。 */
      const item = makeCartItem({ id: "new-line", quantity: 2 });
      const result = cartReducer(null, { type: "ADD", item });

      expect(result).not.toBeNull();
      expect(result!.totalQuantity).toBe(2);
      expect(result!.lines).toHaveLength(1);
    });

    it("仮のカートは決済 URL を持たない (仮の値で決済へ飛ばさない)", () => {
      const result = cartReducer(null, { type: "ADD", item: makeCartItem() });

      expect(result!.id).toBe("");
      expect(result!.checkoutUrl).toBe("");
    });

    it("UPDATE / REMOVE は何もしない (指す行が存在しない)", () => {
      expect(
        cartReducer(null, { type: "UPDATE", lineId: "line-1", quantity: 2 }),
      ).toBeNull();
      expect(cartReducer(null, { type: "REMOVE", lineId: "line-1" })).toBeNull();
    });
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
