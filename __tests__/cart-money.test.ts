/**
 * 数量を押した瞬間に金額も動くこと、そして**説明できない金額は動かさない**ことのテスト。
 *
 * 本番 bcce45e 実測 (2026-08-27 / Setaka 実機指摘): 数量は 16〜75ms で動くのに
 * 行合計・小計・合計は 2,139〜2,417ms のあいだ古いままだった。ここで縛るのは
 * その 2 秒を消すことと、**消すために間違った金額を出さないこと**の両方。
 */
import { describe, it, expect } from "vitest";
import type { Cart, CartItem } from "@/lib/shopify/types";
import { cartReducer } from "@/components/cart/cart-reducer";
import { canDeriveMoney, withDerivedMoney } from "@/components/cart/cart-money";

function line(overrides: {
  id?: string;
  variantId?: string;
  quantity?: number;
  unit?: string;
  lineTotal?: string;
  currency?: string;
} = {}): CartItem {
  const quantity = overrides.quantity ?? 1;
  const unit = overrides.unit ?? "1598";
  const currency = overrides.currency ?? "JPY";
  return {
    id: overrides.id ?? "line-1",
    quantity,
    merchandise: {
      id: overrides.variantId ?? "gid://shopify/ProductVariant/1",
      title: "Default",
      selectedOptions: [],
      product: {
        id: "gid://shopify/Product/1",
        handle: "test",
        title: "Test",
        featuredImage: null,
        vendor: "elxea",
      },
      price: { amount: unit, currencyCode: currency },
    },
    cost: {
      totalAmount: {
        amount: overrides.lineTotal ?? String(Number(unit) * quantity),
        currencyCode: currency,
      },
      amountPerQuantity: { amount: unit, currencyCode: currency },
    },
    sellingPlanAllocation: null,
  };
}

/** サーバが確定させたカート。既定では小計 = 合計 = 行の合計 (elxea の税込表示)。 */
function cart(lines: CartItem[], overrides: Partial<Cart["cost"]> = {}): Cart {
  const sum = lines.reduce((n, l) => n + Number(l.cost.totalAmount.amount), 0);
  return {
    id: "gid://shopify/Cart/1",
    checkoutUrl: "https://elxea.com/checkout",
    totalQuantity: lines.reduce((n, l) => n + l.quantity, 0),
    cost: {
      subtotalAmount: { amount: String(sum), currencyCode: "JPY" },
      totalAmount: { amount: String(sum), currencyCode: "JPY" },
      totalTaxAmount: null,
      ...overrides,
    },
    lines,
  };
}

const amounts = (c: Cart) => ({
  lines: c.lines.map((l) => l.cost.totalAmount.amount),
  subtotal: c.cost.subtotalAmount.amount,
  total: c.cost.totalAmount.amount,
});

describe("数量を押した瞬間に金額も動く", () => {
  it("UPDATE で行合計・小計・合計がその場で引き直される", () => {
    const before = cart([line({ quantity: 1, unit: "1598" })]);

    const after = cartReducer(before, { type: "UPDATE", lineId: "line-1", quantity: 2 })!;

    expect(amounts(after)).toEqual({ lines: ["3196"], subtotal: "3196", total: "3196" });
  });

  it("REMOVE でも合計がその場で減る", () => {
    const before = cart([
      line({ id: "line-1", unit: "1598" }),
      line({ id: "line-2", variantId: "gid://shopify/ProductVariant/2", unit: "1880" }),
    ]);

    const after = cartReducer(before, { type: "REMOVE", lineId: "line-2" })!;

    expect(amounts(after)).toEqual({ lines: ["1598"], subtotal: "1598", total: "1598" });
  });

  it("ADD で既にある行に足したときも合計が動く", () => {
    const before = cart([line({ quantity: 1, unit: "1598" })]);

    const after = cartReducer(before, {
      type: "ADD",
      item: line({ id: "optimistic", quantity: 2, unit: "1598" }),
    })!;

    expect(after.lines[0].quantity).toBe(3);
    expect(amounts(after)).toEqual({ lines: ["4794"], subtotal: "4794", total: "4794" });
  });

  it("小数のある通貨でも桁が崩れない (0.1 + 0.2 を踏まない)", () => {
    const usd = line({ quantity: 1, unit: "10.10", currency: "USD", lineTotal: "10.10" });
    const before: Cart = {
      ...cart([usd]),
      cost: {
        subtotalAmount: { amount: "10.10", currencyCode: "USD" },
        totalAmount: { amount: "10.10", currencyCode: "USD" },
        totalTaxAmount: null,
      },
    };

    const after = cartReducer(before, { type: "UPDATE", lineId: "line-1", quantity: 3 })!;

    expect(after.cost.totalAmount.amount).toBe("30.3");
    expect(Number(after.cost.totalAmount.amount)).toBe(30.3);
  });

  it("定期便の初回割引が入った行でも動く (定価ではなく実額を基準にする)", () => {
    /* elxea の主力は定期便。`merchandise.price` (定価 1,880) を基準にすると
       確かめが必ず外れて引き直しを諦めてしまうので、基準は Shopify が返す
       1 個あたりの実額 (割引後 880) にしてある。 */
    const subscription = line({ quantity: 1, unit: "880", lineTotal: "880" });
    subscription.merchandise.price = { amount: "1880", currencyCode: "JPY" };
    subscription.sellingPlanAllocation = {
      sellingPlan: { id: "gid://shopify/SellingPlan/1", name: "毎月1回お届け" },
    };
    const before = cart([subscription]);
    expect(canDeriveMoney(before)).toBe(true);

    const after = cartReducer(before, { type: "UPDATE", lineId: "line-1", quantity: 2 })!;

    expect(amounts(after)).toEqual({ lines: ["1760"], subtotal: "1760", total: "1760" });
  });

  it("何度押しても基準がずれない (2 → 5 → 1)", () => {
    let state = cart([line({ quantity: 2, unit: "1598" })]);
    state = cartReducer(state, { type: "UPDATE", lineId: "line-1", quantity: 5 })!;
    expect(state.cost.totalAmount.amount).toBe("7990");
    state = cartReducer(state, { type: "UPDATE", lineId: "line-1", quantity: 1 })!;
    expect(state.cost.totalAmount.amount).toBe("1598");
  });
});

describe("説明できない金額には触らない", () => {
  it("数量に比例しない値引きが入っている (1 個あたり × 数量 ≠ 行合計) なら金額を据え置く", () => {
    /* 「2 個目から半額」のような、数量で単価が変わる値引き。掛け算では再現
       できないので、こちらの推測は出さずサーバの着地を待つ
       (遅いが、間違った金額は出ない)。 */
    const before = cart([line({ quantity: 1, unit: "1880", lineTotal: "1500" })]);
    expect(canDeriveMoney(before)).toBe(false);

    const after = cartReducer(before, { type: "UPDATE", lineId: "line-1", quantity: 2 })!;

    expect(after.lines[0].quantity).toBe(2);
    expect(amounts(after)).toEqual({ lines: ["1500"], subtotal: "1500", total: "1500" });
  });

  it("カート値引きが入っている (小計 ≠ 行の合計) なら金額を据え置く", () => {
    const before = cart([line({ quantity: 1, unit: "1598" })], {
      subtotalAmount: { amount: "1400", currencyCode: "JPY" },
      totalAmount: { amount: "1400", currencyCode: "JPY" },
    });
    expect(canDeriveMoney(before)).toBe(false);

    const after = cartReducer(before, { type: "UPDATE", lineId: "line-1", quantity: 2 })!;

    expect(after.cost.totalAmount.amount).toBe("1400");
  });

  it("税・送料が上乗せされている (合計 ≠ 小計) なら金額を据え置く", () => {
    /* 差を固定して持ち越すと、金額に比例する税のときに合計だけ古くなる。
       差ゼロのときだけ引き直すという線引きの回帰テスト。 */
    const before = cart([line({ quantity: 1, unit: "1598" })], {
      totalAmount: { amount: "2098", currencyCode: "JPY" },
    });
    expect(canDeriveMoney(before)).toBe(false);

    const after = cartReducer(before, { type: "UPDATE", lineId: "line-1", quantity: 2 })!;

    expect(after.cost.totalAmount.amount).toBe("2098");
    expect(after.cost.subtotalAmount.amount).toBe("1598");
  });

  it("通貨が揃っていないなら金額を据え置く", () => {
    const mixed = cart([line({ quantity: 1, unit: "1598" })]);
    mixed.lines[0].cost.amountPerQuantity = { amount: "1598", currencyCode: "USD" };
    expect(canDeriveMoney(mixed)).toBe(false);
  });

  it("読めない書式の金額なら金額を据え置く", () => {
    const broken = cart([line({ quantity: 1, unit: "1598" })]);
    broken.cost.subtotalAmount = { amount: "N/A", currencyCode: "JPY" };
    expect(canDeriveMoney(broken)).toBe(false);
  });

  it("カートがまだ無いときの 1 個目 (単価が仮の 0) でも壊れない", () => {
    /* `cart-context` の楽観アイテムは単価 0 のダミー。金額は 0 のままだが、
       ここで例外や NaN を出さないことを縛る (バッジは数量で動く)。 */
    const optimistic = line({ id: "optimistic", quantity: 1, unit: "0", lineTotal: "0" });
    const after = cartReducer(null, { type: "ADD", item: optimistic })!;

    expect(after.totalQuantity).toBe(1);
    expect(after.cost.totalAmount.amount).toBe("0");
  });
});

describe("withDerivedMoney", () => {
  it("引き直せない行が混ざっていたらカートをそのまま返す", () => {
    const broken = cart([line({ quantity: 1, unit: "1598" })]);
    broken.lines[0].cost.amountPerQuantity = { amount: "abc", currencyCode: "JPY" };

    expect(withDerivedMoney(broken)).toBe(broken);
  });

  it("空のカートは小計・合計が 0 になる", () => {
    const empty = cart([]);
    expect(amounts(withDerivedMoney(empty))).toEqual({
      lines: [],
      subtotal: "0",
      total: "0",
    });
  });
});
