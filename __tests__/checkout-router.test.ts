/**
 * Tests for the Worker checkout-router routing logic.
 *
 * Imports the REAL implementation from workers/checkout-router/src/routing.ts.
 * Do not re-declare the routing table here: a local copy makes this suite pass
 * even after the worker's routing changes (the defect this file used to have).
 */
import { describe, it, expect } from "vitest";

import { SHOPIFY_PATH_PREFIXES, isShopifyPath } from "@/workers/checkout-router/src/routing";

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

describe("checkout-router: routing table integrity", () => {
  it("exposes the prefix table used by the worker (guards against a silent empty table)", () => {
    expect(SHOPIFY_PATH_PREFIXES.length).toBeGreaterThan(0);
    expect(SHOPIFY_PATH_PREFIXES).toContain("/checkouts");
    // C3 fix: /admin/ must not be in the proxy table.
    expect(SHOPIFY_PATH_PREFIXES).not.toContain("/admin/");
    // C4 fix: the CDN entry must stay narrowed, never a bare /cdn/.
    expect(SHOPIFY_PATH_PREFIXES).not.toContain("/cdn/");
  });
});
