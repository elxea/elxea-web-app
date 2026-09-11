// Verifier: does a domain=elxea.com cookie set on apex make www load GTM? (GTM aborted)
import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name: "cookie_consent", value: "all", domain: ".elxea.com", path: "/" }]);
for (const host of ["https://elxea.com", "https://www.elxea.com"]) {
  const page = await ctx.newPage();
  const attempted = [];
  await page.route("**://*.googletagmanager.com/**", (r) => { attempted.push(r.request().url()); return r.abort(); });
  await page.goto(`${host}/password`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);
  console.log(`${host} (cookie only, no localStorage) #gtm-script=${await page.locator("#gtm-script").count()} attempted=${attempted.length}`);
  await page.close();
}
await browser.close();
