import { test, expect, type Page } from "@playwright/test";

/**
 * Cookie banner + Google Tag Manager consent gate.
 *
 * Both defects this covers were measured in a real browser against the code as
 * it shipped:
 *  (A) the banner had to survive a reload for a visitor who already chose;
 *  (B) `gtm.js` loaded before any choice AND after "必要なもののみ".
 *
 * Requests to googletagmanager.com are aborted so nothing leaves the runner —
 * the assertions are on the injected snippet and on the attempted request, not
 * on Google's response.
 */

const GTM_ID = "GTM-E2ETEST";
const BANNER = "このサイトではCookieを使用して";
const ACCEPT = "同意する";
const DECLINE = "必要なもののみ";
const SETTINGS = "Cookie 設定";

/** Aborts every GTM request and returns the URLs that were attempted. */
async function trapGtmRequests(page: Page): Promise<string[]> {
  const attempted: string[] = [];
  await page.route("**://*.googletagmanager.com/**", (route) => {
    attempted.push(route.request().url());
    return route.abort();
  });
  return attempted;
}

function gtmSnippet(page: Page) {
  return page.locator("#gtm-script");
}

/**
 * Whether *any* GTM markup exists in the document.
 *
 * A string check rather than an element locator on purpose: the `<noscript>`
 * fallback's children are inert text when scripting is enabled, so
 * `locator('iframe[src*=...]')` reports 0 even when the markup is there — which
 * would make the "must be absent" assertions pass vacuously.
 */
function gtmMarkupPresent(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.innerHTML.includes("googletagmanager.com"),
  );
}

/** Seeds a stored choice before the app's first render. */
async function seedChoice(page: Page, value: string) {
  await page.addInitScript((stored) => {
    window.localStorage.setItem("cookie-consent", stored);
  }, value);
}

test.describe("cookie consent banner", () => {
  test("(a) stays hidden for a visitor who already accepted", async ({ page }) => {
    await seedChoice(page, "all");
    await page.goto("/ja");

    await expect(page.getByText(BANNER)).toBeHidden();

    // The reported symptom was the banner returning on every visit.
    await page.reload();
    await expect(page.getByText(BANNER)).toBeHidden();
  });

  test("(a) stays hidden for a visitor who already declined", async ({ page }) => {
    await seedChoice(page, "essential");
    await page.goto("/ja");

    await expect(page.getByText(BANNER)).toBeHidden();

    await page.reload();
    await expect(page.getByText(BANNER)).toBeHidden();
  });

  test("(a) survives a reload after clicking, not just the click", async ({ page }) => {
    await page.goto("/ja");
    await expect(page.getByText(BANNER)).toBeVisible();

    await page.getByRole("button", { name: ACCEPT }).click();
    await expect(page.getByText(BANNER)).toBeHidden();

    await page.reload();
    await expect(page.getByText(BANNER)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem("cookie-consent"))).toBe("all");
  });

  test("appears again when the footer entry is used, without losing the choice", async ({
    page,
  }) => {
    await seedChoice(page, "essential");
    await page.goto("/ja");
    await expect(page.getByText(BANNER)).toBeHidden();

    // Activated by keyboard: the site's fixed chat bar (`bottom-0 z-40`) covers
    // the footer's legal row whenever the page is scrolled to the bottom, so a
    // pointer click is intercepted. That overlap is pre-existing and affects
    // every link in that row (特商法 / プライバシー / 利用規約 / 返品) — it is not
    // introduced by this button and is out of scope here.
    const settings = page.getByRole("button", { name: SETTINGS });
    await settings.focus();
    await settings.press("Enter");

    await expect(page.getByText(BANNER)).toBeVisible();
    // Re-opening the panel must not silently un-record the existing choice.
    expect(await page.evaluate(() => localStorage.getItem("cookie-consent"))).toBe(
      "essential",
    );
  });
});

test.describe("google tag manager consent gate", () => {
  test("(b) is absent before any choice is made", async ({ page }) => {
    const attempted = await trapGtmRequests(page);
    await page.goto("/ja");
    await expect(page.getByText(BANNER)).toBeVisible();

    await expect(gtmSnippet(page)).toHaveCount(0);
    expect(await gtmMarkupPresent(page)).toBe(false);
    expect(attempted).toEqual([]);
  });

  test("(b) stays absent after 必要なもののみ, including on the next load", async ({
    page,
  }) => {
    const attempted = await trapGtmRequests(page);
    await page.goto("/ja");

    await page.getByRole("button", { name: DECLINE }).click();
    await expect(page.getByText(BANNER)).toBeHidden();
    await expect(gtmSnippet(page)).toHaveCount(0);

    await page.reload();
    await expect(gtmSnippet(page)).toHaveCount(0);
    expect(await gtmMarkupPresent(page)).toBe(false);
    expect(attempted).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem("cookie-consent"))).toBe(
      "essential",
    );
  });

  // The matching dataLayer gate (pushes happen only after consent) is covered
  // in __tests__/analytics-consent.test.ts rather than here: firing a real
  // `view_item` needs a product detail page, and CI runs the e2e suite without
  // Shopify credentials, so the product listing is empty on the runner.

  test("(c) loads after 同意する, in the same page and after a reload", async ({
    page,
  }) => {
    const attempted = await trapGtmRequests(page);
    await page.goto("/ja");
    await expect(gtmSnippet(page)).toHaveCount(0);

    await page.getByRole("button", { name: ACCEPT }).click();

    // No reload needed — the banner and the container share one store.
    await expect(gtmSnippet(page)).toHaveCount(1);
    // `toContainText` reports "" for <script>, so read the source directly.
    expect(await gtmSnippet(page).evaluate((el) => el.textContent ?? "")).toContain(
      GTM_ID,
    );
    expect(await gtmMarkupPresent(page)).toBe(true);

    await page.reload();
    await expect(gtmSnippet(page)).toHaveCount(1);
    await expect
      .poll(() => attempted.some((url) => url.includes(`gtm.js?id=${GTM_ID}`)))
      .toBe(true);
  });

  test("(c) loads on first paint for a visitor who accepted earlier", async ({ page }) => {
    await trapGtmRequests(page);
    await seedChoice(page, "all");
    await page.goto("/ja");

    await expect(page.getByText(BANNER)).toBeHidden();
    await expect(gtmSnippet(page)).toHaveCount(1);
  });
});
