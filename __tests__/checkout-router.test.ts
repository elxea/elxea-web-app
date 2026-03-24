/**
 * Tests for the Worker checkout-router routing logic.
 *
 * Replicates the isShopifyPath function from
 * workers/checkout-router/src/index.ts to verify which paths
 * route to Shopify vs Vercel.
 */
import { describe, it, expect } from "vitest";

// Replicate the routing table from the worker
const SHOPIFY_PATH_PREFIXES = [
  "/checkouts/",
  "/checkouts",
  "/cart/add",
  "/cart/update",
  "/cart/change",
  "/cart/clear",
  "/cart.js",
  "/cart.json",
  "/services/",
  "/.well-known/shopify/",
  "/payments/",
  "/wallets/",
  // After C3 fix: /admin/ removed, /cdn/ narrowed
  "/cdn/shopifycloud/",
  "/cdn/s/",
];

function isShopifyPath(pathname: string): boolean {
  return SHOPIFY_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

describe("checkout-router: isShopifyPath", () => {
  describe("Shopify paths (should proxy to Shopify)", () => {
    const shopifyPaths = [
      "/checkouts",
      "/checkouts/abc123",
      "/checkouts/abc123/processing",
      "/cart/add",
      "/cart/update",
      "/cart/change",
      "/cart/clear",
      "/cart.js",
      "/cart.json",
      "/services/ping",
      "/.well-known/shopify/something",
      "/payments/config",
      "/wallets/checkouts",
      "/cdn/shopifycloud/web/assets/v1/checkout.css",
      "/cdn/s/files/1/theme.js",
    ];

    for (const p of shopifyPaths) {
      it(`routes "${p}" to Shopify`, () => {
        expect(isShopifyPath(p)).toBe(true);
      });
    }
  });

  describe("Vercel paths (should passthrough)", () => {
    const vercelPaths = [
      "/",
      "/ja",
      "/ja/products",
      "/ja/products/sencha",
      "/ja/journal",
      "/ja/about",
      "/ja/faq",
      "/api/auth/login",
      "/api/revalidate",
      "/studio",
      "/studio/desk",
      // Security: /admin/ must NOT proxy to Shopify (C3 fix)
      "/admin",
      "/admin/",
      "/admin/api/2024-01/products.json",
      // Narrowed CDN: generic /cdn/ paths must NOT proxy (C4 fix)
      "/cdn/",
      "/cdn/fonts/something.woff2",
      "/cdn/other/path",
    ];

    for (const p of vercelPaths) {
      it(`routes "${p}" to Vercel`, () => {
        expect(isShopifyPath(p)).toBe(false);
      });
    }
  });

  describe("edge cases", () => {
    it("empty path goes to Vercel", () => {
      expect(isShopifyPath("")).toBe(false);
    });

    it("/cart without sub-path goes to Vercel (not a Shopify cart action)", () => {
      expect(isShopifyPath("/cart")).toBe(false);
    });

    it("/cart/ without action goes to Vercel", () => {
      expect(isShopifyPath("/cart/")).toBe(false);
    });
  });
});
