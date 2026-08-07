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
