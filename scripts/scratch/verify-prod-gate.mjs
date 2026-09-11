/**
 * Production verification of the GTM consent gate, without the site password.
 *
 * `/password` is reachable unauthenticated and sits under the ROOT layout, which
 * is where the gate is mounted — so the deployed bundle's gating logic runs
 * there just as it does on `/ja`. Before this fix that page carried GTM
 * (measured: 1 gtm.js + 2 ns.html in its HTML).
 *
 * Three states are exercised against the real deployment:
 *   1. no stored choice   -> no GTM markup, no googletagmanager request
 *   2. stored "essential" -> same
 *   3. stored "all"       -> GTM snippet present and gtm.js requested
 *
 * Requests to googletagmanager.com are allowed through in state 3 only so the
 * request can be observed, then aborted before they complete.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://elxea.com";

async function probe(storedChoice) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const gtmRequests = [];
    await page.route("**://*.googletagmanager.com/**", (route) => {
      gtmRequests.push(route.request().url());
      return route.abort();
    });

    if (storedChoice) {
      await page.addInitScript((value) => {
        window.localStorage.setItem("cookie-consent", value);
      }, storedChoice);
    }

    await page.goto(`${BASE}/password`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);

    return {
      stored: storedChoice ?? null,
      url: page.url(),
      gtmScriptTags: await page.locator("#gtm-script").count(),
      gtmMarkupInDom: await page.evaluate(() =>
        document.documentElement.innerHTML.includes("googletagmanager.com"),
      ),
      gtmRequests,
      dataLayerLength: await page.evaluate(
        () => (window.dataLayer ?? []).length,
      ),
    };
  } finally {
    await browser.close();
  }
}

const out = {
  base: BASE,
  checked_at_utc: new Date().toISOString(),
  "1_no_choice": await probe(null),
  "2_declined": await probe("essential"),
  "3_accepted": await probe("all"),
};

console.log(JSON.stringify(out, null, 2));
