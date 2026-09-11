/**
 * Reproduction harness for the cookie-consent bugs.
 *
 * Usage: node scripts/scratch/zz-consent-repro.mjs [baseUrl]
 *
 * Checks, against a real browser with a persistent-per-run context:
 *   1. banner visible on first visit
 *   2. click Accept -> banner gone
 *   3. RELOAD -> banner must stay gone (bug A)
 *   4. localStorage value after accept
 *   5. whether the GTM script tag is present before any choice (bug B)
 *   6. whether the GTM script tag is present after Decline (bug B)
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3577";
const url = `${base}/ja`;

const BANNER = 'text=このサイトではCookieを使用して';

function gtmPresent(page) {
  return page.evaluate(() => ({
    scriptTag: !!document.getElementById("gtm-script"),
    gtmJs: [...document.querySelectorAll("script[src]")].some((s) =>
      s.src.includes("googletagmanager.com/gtm.js"),
    ),
    dataLayer: Array.isArray(window.dataLayer) ? window.dataLayer.length : null,
    noscriptIframe: document.body.innerHTML.includes(
      "googletagmanager.com/ns.html",
    ),
  }));
}

const out = {};
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto(url, { waitUntil: "networkidle" });
out["1_banner_on_first_visit"] = await page.locator(BANNER).first().isVisible();
out["5_gtm_before_choice"] = await gtmPresent(page);

// Decline path (fresh context)
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
await p2.goto(url, { waitUntil: "networkidle" });
await p2.getByRole("button", { name: "必要なもののみ" }).click();
await p2.waitForTimeout(1500);
out["6_gtm_after_decline_same_page"] = await gtmPresent(p2);
await p2.reload({ waitUntil: "networkidle" });
await p2.waitForTimeout(2000);
out["6b_gtm_after_decline_reload"] = await gtmPresent(p2);
out["6c_banner_after_decline_reload"] = await p2
  .locator(BANNER)
  .first()
  .isVisible()
  .catch(() => false);
out["6d_ls_after_decline"] = await p2.evaluate(() =>
  localStorage.getItem("cookie-consent"),
);

// Accept path
await page.getByRole("button", { name: "同意する" }).click();
await page.waitForTimeout(1000);
out["2_banner_after_accept"] = await page
  .locator(BANNER)
  .first()
  .isVisible()
  .catch(() => false);
out["4_ls_after_accept"] = await page.evaluate(() =>
  localStorage.getItem("cookie-consent"),
);
out["4b_gtm_after_accept_same_page"] = await gtmPresent(page);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
out["3_banner_after_reload"] = await page
  .locator(BANNER)
  .first()
  .isVisible()
  .catch(() => false);
out["3b_ls_after_reload"] = await page.evaluate(() =>
  localStorage.getItem("cookie-consent"),
);
out["3c_gtm_after_accept_reload"] = await gtmPresent(page);

// Navigate to another page in the same session (client-side nav)
await page.goto(`${base}/ja/faq`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
out["7_banner_on_other_page"] = await page
  .locator(BANNER)
  .first()
  .isVisible()
  .catch(() => false);

console.log(JSON.stringify(out, null, 2));
await browser.close();
