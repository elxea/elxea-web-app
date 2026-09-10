import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Precondition helpers for E2E specs.
 *
 * Why this exists
 * ---------------
 * The cart specs used to wrap every step in `if (!ok) { test.skip(); return; }`.
 * When Shopify was unreachable — or when the storefront simply had no
 * purchasable product — every assertion was skipped and the run stayed green.
 * CI reported success while verifying nothing (see the 2026-08-07 test audit).
 *
 * The rule now is: **an unmet precondition is a failure, not a silent skip.**
 *
 * The only escape hatch is the explicit opt-in env var `E2E_ALLOW_SKIP=1`, for
 * a developer machine without storefront credentials. Even then the skip is
 * *reported*: it is annotated on the test result and printed to stdout, so a
 * skipped precondition can never be mistaken for a passing assertion. CI must
 * never set `E2E_ALLOW_SKIP`.
 */
const ALLOW_SKIP = process.env.E2E_ALLOW_SKIP === "1";

/**
 * True when the Shopify Storefront API is reachable (both credentials present).
 *
 * 商品一覧・商品詳細・検索は資格情報が無くても見本カタログで動く
 * (`lib/preview-seed-storefront.ts`)。**動かないのはその先** —
 * カートへの書き込み (`cartCreate` / `cartLinesAdd`)、Shopify が発行する
 * チェックアウト URL、そして SellingPlan (定期便) の存在。これらは実在の
 * ストアに依存するので、見本データで代替すると「受け渡しが本当に成立するか」
 * という検証そのものが消える。
 */
export const STOREFRONT_CONFIGURED = Boolean(
  process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
);

/**
 * 定期便 (SellingPlan) を要求するテストの skip 理由。
 *
 * 見本カタログは `sellingPlanGroups: []` を意図的に持つ。SellingPlan だけ
 * 見本で生やしても「定期購入」ボタンが出るところまでで、その先のカート書き込みは
 * Shopify 実契約が無いと必ず失敗するため、途中で落ちるテストが増えるだけになる。
 * CI に SellingPlan の fixture が無いことは docs/ci-gates.md と ci.yml の
 * 「Report skipped tests」ステップが既に前提として書いている。
 *
 * 共有定数にしてあるのは、CI サマリでこれらが 1 原因としてまとまるため。
 */
export const SELLING_PLAN_SKIP_REASON =
  "Shopify Storefront の資格情報が未設定 — 定期便 (SellingPlan) の商品は実ストアにしか無く、" +
  "見本カタログ (PREVIEW_SEED_STOREFRONT) は sellingPlanGroups を意図的に空にしている";

/**
 * Fails the test with a precondition message, or — only when `E2E_ALLOW_SKIP=1`
 * — records an explicit, annotated skip.
 */
export function unmetPrecondition(what: string): never {
  const message = `Precondition not met: ${what}`;

  if (ALLOW_SKIP) {
    test.info().annotations.push({ type: "precondition-skip", description: message });
    // Visible in the run output so an allowed skip is never invisible.
    console.warn(`[e2e][SKIP] ${message} (E2E_ALLOW_SKIP=1)`);
    test.skip(true, message);
  }

  throw new Error(
    `${message}\n` +
      "The storefront/CMS fixtures required by this test are missing. " +
      "This is a real failure: fix the environment or the fixture data. " +
      "Set E2E_ALLOW_SKIP=1 locally to downgrade it to a reported skip (never in CI).",
  );
}

/** Asserts a locator is visible, converting a miss into a precondition failure. */
export async function requireVisible(locator: Locator, what: string): Promise<void> {
  const visible = await locator.first().isVisible().catch(() => false);
  if (!visible) unmetPrecondition(what);
}

/**
 * Opens the first product detail page that is actually purchasable.
 *
 * Returns the product title. Throws (or reports a skip) when the storefront has
 * no product, or when the product has no working "add to cart" affordance.
 */
export async function openPurchasableProduct(page: Page): Promise<string> {
  await page.goto("/ja/products");

  const productLink = page.locator("a[href*='/products/']").first();
  await requireVisible(productLink, "storefront has at least one product on /ja/products");

  await productLink.click();
  await page.waitForURL(/\/ja\/products\/.+/);

  const addToCart = page.getByRole("button", { name: "カートに追加" });
  await requireVisible(addToCart, "first product is available for sale (カートに追加 button)");

  const title = (await page.locator("h1").first().textContent())?.trim();
  if (!title) unmetPrecondition("product detail page renders an h1 title");

  return title;
}

/** Clicks "add to cart" and waits for the Server Action to settle. */
export async function addToCart(page: Page): Promise<void> {
  await page.getByRole("button", { name: "カートに追加" }).click();

  // The button shows "..." while the Server Action is in flight.
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).some(
        (b) => b.disabled && b.textContent?.includes("..."),
      ),
    { timeout: 20_000 },
  );
}

/**
 * Navigates to the cart and asserts it is NOT empty.
 *
 * A cart that stayed empty after "add to cart" means the Shopify write failed —
 * that is a hard failure of the checkout path, which is exactly what this suite
 * exists to catch. It is never skipped.
 */
export async function gotoNonEmptyCart(page: Page): Promise<void> {
  await page.goto("/ja/cart");
  await expect(
    page.getByText("カートは空です"),
    "cart is empty after adding a product — the Shopify cart write failed",
  ).toHaveCount(0);
}

/**
 * 会員としてログインした状態を要求するテストの前提。
 *
 * 顧客プロファイル 第1段 の画面 (`/account/this-month` / `/account/safety`) は
 * 択一 #11 の確定「本人はログインで解決する。URL に個人の番号を出さない」により
 * **ログイン必須**である。ログインは Shopify Customer Account API の OAuth
 * (または LINE Login) を実際に往復するので、資格情報の無い CI では成立しない。
 *
 * `STOREFRONT_CONFIGURED` と同じ扱いにしてあるのは、どちらも「実ストアの資格情報が
 * 無いと作れない状態」だから。見本データでログイン済みを偽装すると、
 * **「本人にしか問いを出さない」という検査そのものが消える**（誰でも通る画面を
 * 検査して緑にするのは、S5 が批判した「見ていない緑」と同じ）。
 *
 * skip は `pnpm report:e2e-skips` が CI サマリに理由付きで出すので不可視にならない。
 */
export const MEMBER_SESSION_CONFIGURED = Boolean(
  process.env.E2E_MEMBER_SESSION === "1" && STOREFRONT_CONFIGURED,
);

export const MEMBER_SESSION_SKIP_REASON =
  "会員セッションが未設定 — 顧客プロファイル 第1段 の画面は択一 #11 によりログイン必須で、" +
  "ログインは Shopify Customer Account API の OAuth 往復を要する。CI に資格情報が無いので " +
  "成立しない (E2E_MEMBER_SESSION=1 + Storefront 資格情報のある環境でのみ走る)";
