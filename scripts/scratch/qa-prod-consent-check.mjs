// Verifier: production consent-gate check. GTM requests are ABORTED (nothing reaches Google).
import { chromium } from "@playwright/test";

const hosts = ["https://elxea.com", "https://www.elxea.com"];
const states = [
  ["none", null],
  ["essential", "essential"],
  ["all", "all"],
];

const browser = await chromium.launch();
for (const host of hosts) {
  for (const [label, stored] of states) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const attempted = [];
    await page.route("**://*.googletagmanager.com/**", (route) => {
      attempted.push(route.request().url());
      return route.abort();
    });
    if (stored) {
      await page.addInitScript((v) => {
        window.localStorage.setItem("cookie-consent", v);
      }, stored);
    }
    await page.goto(`${host}/password`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);
    const snippetCount = await page.locator("#gtm-script").count();
    const markup = await page.evaluate(() =>
      document.documentElement.innerHTML.includes("googletagmanager.com"),
    );
    console.log(
      `${host} state=${label} #gtm-script=${snippetCount} gtm_markup=${markup} gtm_requests_attempted=${attempted.length} ${attempted[0] ?? ""}`,
    );
    await ctx.close();
  }
}
await browser.close();
