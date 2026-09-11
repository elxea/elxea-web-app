import { test, expect } from "@playwright/test";

/**
 * Japanese rendering regression guard.
 *
 * `tokens/overrides/cjk.json` -> `dist/tokens-cjk.css` -> `:lang(ja)` is the
 * chain that gives Japanese copy its own line-height and letter-spacing, and
 * that puts a Japanese face in every font stack. The 2026-08-07 test audit
 * found zero tests anywhere touching it (finding "不足 #3"), so a broken token
 * build or a dropped `@import` would ship silently.
 *
 * These assertions read *computed* style in a real browser, so they fail on any
 * break in the chain: token JSON, Style Dictionary build, CSS import order, or
 * the `lang` attribute on <html>.
 *
 * The discriminator between base and CJK tokens is line-height
 * (h1 1.3 -> 1.4, body 1.75 -> 1.8); the Japanese fallback face
 * (dnp-shuei-gothic-gin-std) must be present in both.
 */
test.describe("Japanese (CJK) typography", () => {
  test("html is tagged lang=ja so :lang(ja) rules apply", async ({ page }) => {
    await page.goto("/ja");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  });

  test("dist/tokens-cjk.css is loaded and overrides the base typography tokens", async ({
    page,
  }) => {
    await page.goto("/ja");

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        h1: style.getPropertyValue("--typography-style-h1").trim(),
        body: style.getPropertyValue("--typography-style-body").trim(),
      };
    });

    expect(tokens.h1, "--typography-style-h1 is not defined at all").not.toBe("");
    expect(tokens.body, "--typography-style-body is not defined at all").not.toBe("");

    // Japanese fallback face must survive into the resolved token.
    expect(tokens.h1).toContain("dnp-shuei-gothic-gin-std");
    expect(tokens.body).toContain("dnp-shuei-gothic-gin-std");

    // CJK-only line-heights — these are what proves tokens-cjk.css won over
    // the base tokens (base is /1.3 and /1.75).
    expect(tokens.h1, "h1 token is still the base (/1.3) — CJK override lost").toContain("/1.4");
    expect(tokens.body, "body token is still the base (/1.75) — CJK override lost").toContain(
      "/1.8",
    );
  });

  test("Japanese body copy gets the CJK line-height and letter-spacing", async ({ page }) => {
    await page.goto("/ja");

    const body = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {
        fontSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        letterSpacing: parseFloat(style.letterSpacing),
        fontFamily: style.fontFamily,
      };
    });

    // :lang(ja) { line-height: 1.8; letter-spacing: 0.04em }
    expect(body.lineHeight / body.fontSize).toBeCloseTo(1.8, 2);
    expect(body.letterSpacing / body.fontSize).toBeCloseTo(0.04, 3);

    // Japanese fallback face must be present in the resolved stack.
    expect(body.fontFamily).toContain("dnp-shuei-gothic-gin-std");
  });

  test("headings keep their design line-height under :lang(ja)", async ({ page }) => {
    await page.goto("/ja/about");

    const h1 = await page.locator("h1").first().evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        fontSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        letterSpacing: parseFloat(style.letterSpacing),
      };
    });

    // globals.css pins :lang(ja) h1 to 1.2 so the 1.8 body cadence does not
    // stretch headings. Regressing this is a visible layout break.
    expect(h1.lineHeight / h1.fontSize).toBeCloseTo(1.2, 2);
    // :lang(ja) h1..h6 { letter-spacing: 0.02em }
    expect(h1.letterSpacing / h1.fontSize).toBeCloseTo(0.02, 3);
  });
});
