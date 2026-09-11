import { test, expect } from "@playwright/test";

/**
 * Staging smoke tests — lightweight checks that run after deploy to staging.
 * Validates critical pages load without JS errors.
 *
 * Usage:
 *   BASE_URL=https://staging.example.com pnpm exec playwright test e2e/staging-smoke.spec.ts
 *
 * Default BASE_URL: http://localhost:3000
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// The app uses locale-prefixed routes; / redirects to /ja.
const url = (path: string) => {
  if (path === "/") return `${BASE_URL}/ja`;
  // Prefix with /ja if not already locale-prefixed
  if (!path.startsWith("/ja") && !path.startsWith("/en")) {
    return `${BASE_URL}/ja${path}`;
  }
  return `${BASE_URL}${path}`;
};

test.describe("Staging Smoke Tests", () => {
  test("homepage loads without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(url("/"));
    await expect(page).toHaveTitle(/elxea/i);
    await expect(page.locator("h1")).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test("products page renders", async ({ page }) => {
    await page.goto(url("/products"));
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
  });

  test("cart is accessible", async ({ page }) => {
    await page.goto(url("/"));
    const header = page.locator("header");
    const cartLink = header.getByText("カート");
    await expect(cartLink).toBeVisible();
  });

  test("no console errors on key pages", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`${page.url()}: ${err.message}`));

    const pages = ["/", "/products", "/about", "/faq"];
    for (const path of pages) {
      await page.goto(url(path));
      await page.waitForLoadState("domcontentloaded");
    }

    expect(errors).toHaveLength(0);
  });
});
