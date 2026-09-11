/**
 * Tests for Shopify webhook HMAC-SHA256 verification.
 */
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyShopifyHmac } from "@/lib/shopify/webhooks/verify";

const TEST_SECRET = "test-webhook-secret-12345";

function computeHmac(body: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
}

describe("verifyShopifyHmac", () => {
  it("returns true for a valid HMAC", () => {
    const body = JSON.stringify({ shop_domain: "elxea.myshopify.com", customer: { id: 123 } });
    const hmac = computeHmac(body, TEST_SECRET);

    expect(verifyShopifyHmac(body, hmac, TEST_SECRET)).toBe(true);
  });

  it("returns false for an invalid HMAC", () => {
    const body = '{"shop_domain":"elxea.myshopify.com"}';
    const wrongHmac = "dGhpcyBpcyBub3QgYSB2YWxpZCBobWFj"; // base64 garbage

    expect(verifyShopifyHmac(body, wrongHmac, TEST_SECRET)).toBe(false);
  });

  it("returns false when the body has been tampered with", () => {
    const originalBody = '{"amount":100}';
    const hmac = computeHmac(originalBody, TEST_SECRET);
    const tamperedBody = '{"amount":999}';

    expect(verifyShopifyHmac(tamperedBody, hmac, TEST_SECRET)).toBe(false);
  });

  it("returns false when the secret is wrong", () => {
    const body = '{"test":true}';
    const hmac = computeHmac(body, TEST_SECRET);

    expect(verifyShopifyHmac(body, hmac, "wrong-secret")).toBe(false);
  });

  it("handles empty body correctly", () => {
    const body = "";
    const hmac = computeHmac(body, TEST_SECRET);

    expect(verifyShopifyHmac(body, hmac, TEST_SECRET)).toBe(true);
  });

  it("handles unicode body correctly", () => {
    const body = JSON.stringify({ name: "elxea お茶" });
    const hmac = computeHmac(body, TEST_SECRET);

    expect(verifyShopifyHmac(body, hmac, TEST_SECRET)).toBe(true);
  });

  it("returns false for mismatched length HMACs", () => {
    const body = '{"test":true}';
    // A truncated HMAC should fail
    expect(verifyShopifyHmac(body, "abc", TEST_SECRET)).toBe(false);
  });
});
