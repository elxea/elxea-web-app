import type { Cart, CartItem } from "@/lib/shopify/types";

/**
 * 数量を押した瞬間に**金額も動かす**ための引き直し。
 *
 * ## なぜ要るか (Setaka 実機指摘 2026-08-27 / 本番 bcce45e 実測)
 *
 * 数量は押した瞬間に動いていた (本番実測 16〜75ms) のに、行合計・小計・合計は
 * **2,139〜2,417ms のあいだ古いまま**だった。`cartReducer` が `quantity` と
 * `totalQuantity` しか書き換えず、`cost.*` はサーバの往復 (Server Action →
 * Shopify → `revalidatePath("/", "layout")`) が着地して初めて入れ替わるため。
 * 「2 個になっているのに 1 個ぶんの金額」という中間状態が 2 秒続く。
 *
 * ## 金額を楽観更新することの危うさと、その避け方
 *
 * `mutation-classes.ts` は「金銭・契約を `optimistic` にしない」と定めている。
 * ただしそれが禁じているのは**成立したかどうかを先に見せること** (決済確定・
 * 解約) であって、既に成立している行の**掛け算を先に見せること**ではない。
 * ここで動かすのは「単価 × 数量」という、客がその場で暗算できる値だけ。
 *
 * それでも、値引き・税・送料が絡むと掛け算では説明できない。そこで
 * **引き直す前に、サーバが確定させた今の金額を自分の掛け算で再現できるか
 * 確かめる** (`canDeriveMoney`)。再現できない組み合わせ (プラン割引・
 * カート値引き・税が上乗せの通貨) では引き直しを**まるごと諦め**、従来どおり
 * サーバの着地を待つ。**確かめられない金額は出さない**。
 *
 * 着地後の突合は `useOptimistic` が構造的に持っている — 遷移が閉じた時点で
 * 画面はサーバの値へ戻るので、こちらの推測とサーバの確定値が食い違ったときは
 * **必ず確定値が勝つ**。
 */

/**
 * 受け付ける小数桁。Shopify の Money は通貨の最小単位まで
 * (JPY 0 / USD 2 / KWD 3)。これを超える精度は読めないものとして扱う。
 */
const SCALE = 4;

/**
 * "1598.0" → 15980000。金額を**整数**に直してから足し引きする
 * (`0.1 + 0.2` を踏まないため)。読めない書式・桁あふれは `null`。
 */
function toUnits(amount: string): number | null {
  const text = amount.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  if (fraction.length > SCALE) return null;
  const units = Number(whole + fraction.padEnd(SCALE, "0"));
  if (!Number.isSafeInteger(units)) return null;
  return negative ? -units : units;
}

/** 15980000 → "1598"。`toUnits` の逆。丸めは起きない (割り算をしないため)。 */
function fromUnits(units: number): string {
  const negative = units < 0;
  const digits = String(Math.abs(units)).padStart(SCALE + 1, "0");
  const whole = digits.slice(0, digits.length - SCALE);
  const fraction = digits.slice(digits.length - SCALE).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * その行の「1 個あたりの実額 × 数量」。読めなければ `null`。
 *
 * 基準は `cost.amountPerQuantity` (プラン調整後の実額) であって
 * `merchandise.price` (調整前の定価) ではない。定期便の初回割引が入った行で
 * 定価を使うと、確かめの段階で必ず食い違って引き直しを諦めることになる。
 */
function lineUnits(line: CartItem): number | null {
  const unit = toUnits(line.cost.amountPerQuantity.amount);
  if (unit === null) return null;
  const units = unit * line.quantity;
  return Number.isSafeInteger(units) ? units : null;
}

/**
 * いまの金額を「1 個あたりの実額 × 数量」だけで説明できるか。
 *
 * 次の 4 つが**すべて**成り立つときだけ引き直してよい。
 *
 *   1. 通貨がカートと全行で揃っている
 *   2. 各行の `cost.totalAmount` が 1 個あたりの実額 × 数量に一致する
 *      (数量に比例しない行値引きが無い)
 *   3. 小計が行の合計に一致する (カート値引きが無い)
 *   4. 合計が小計に一致する (税・送料が上乗せされていない)
 *
 * 4 を「差を持ち越す」ではなく「差ゼロ」に絞ってあるのは、税が金額に比例する
 * 通貨で差を固定したまま持ち越すと**税額だけ古い合計**を出してしまうため。
 * 上乗せのある構成になったら、ここが `false` を返して従来どおりサーバの着地を
 * 待つ側へ倒れる (遅くはなるが、間違った金額は出ない)。
 */
export function canDeriveMoney(cart: Cart): boolean {
  const currency = cart.cost.subtotalAmount.currencyCode;
  if (cart.cost.totalAmount.currencyCode !== currency) return false;

  let sum = 0;
  for (const line of cart.lines) {
    if (line.cost.totalAmount.currencyCode !== currency) return false;
    if (line.cost.amountPerQuantity.currencyCode !== currency) return false;
    const derived = lineUnits(line);
    const stated = toUnits(line.cost.totalAmount.amount);
    if (derived === null || stated === null) return false;
    if (derived !== stated) return false;
    sum += derived;
  }
  if (!Number.isSafeInteger(sum)) return false;

  const subtotal = toUnits(cart.cost.subtotalAmount.amount);
  const total = toUnits(cart.cost.totalAmount.amount);
  if (subtotal === null || total === null) return false;
  return subtotal === sum && total === sum;
}

/**
 * 数量を書き換えたあとのカートの金額を、いまの数量で引き直す。
 *
 * **`canDeriveMoney` が `true` を返した状態から派生したカートにだけ使うこと**。
 * 引き直せない行が混ざっていたら金額には触らず、そのまま返す。
 */
export function withDerivedMoney(cart: Cart): Cart {
  const currency = cart.cost.subtotalAmount.currencyCode;

  let sum = 0;
  const lines: CartItem[] = [];
  for (const line of cart.lines) {
    const units = lineUnits(line);
    if (units === null) return cart;
    sum += units;
    const amount = fromUnits(units);
    lines.push(
      line.cost.totalAmount.amount === amount
        ? line
        : {
            ...line,
            cost: { ...line.cost, totalAmount: { amount, currencyCode: currency } },
          },
    );
  }
  if (!Number.isSafeInteger(sum)) return cart;

  const amount = fromUnits(sum);
  return {
    ...cart,
    lines,
    cost: {
      ...cart.cost,
      subtotalAmount: { amount, currencyCode: currency },
      totalAmount: { amount, currencyCode: currency },
    },
  };
}
