import { chromium } from "playwright";
import fs from "fs";
const TOKEN = fs.readFileSync("/tmp/wave8_token.txt", "utf8").trim();
const BASE = "http://localhost:3541";
const OUT = "/tmp/circl-boss-elxea-webapp-20260702/scratchpad";
const pages = [
  ["products-list", "/ja/products"],
  ["product-detail", "/ja/products/tea-ats-b-01"],
  ["collections-list", "/ja/collections"],
  ["collection-detail", "/ja/collections/assorted-tea-set"],
  ["cart-empty", "/ja/cart"],
];
const viewports = [["pc", 1440, 1024], ["sp", 390, 844]];
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([
  { name: "site_auth", value: TOKEN, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
]);
for (const [vp, w, h] of viewports) {
  const page = await context.newPage();
  await page.setViewportSize({ width: w, height: h });
  for (const [name, path] of pages) {
    const resp = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    const out = `${OUT}/wave8-${name}-${vp}.png`;
    await page.screenshot({ path: out, fullPage: true });
    console.log(`${resp.status()}  ${vp}  ${name}  -> ${out}`);
  }
  await page.close();
}
// Cart with an item (PC only) — local add-to-cart, NO checkout navigation.
try {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(BASE + "/ja/products/tea-ats-b-01", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  // Click the add-to-cart button (label may be カートに追加); do not touch checkout.
  const btn = page.getByRole("button", { name: /カートに追加|カートに入れる|Add to cart/i }).first();
  await btn.click({ timeout: 8000 });
  await page.waitForTimeout(3500);
  await page.goto(BASE + "/ja/cart", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);
  const out = `${OUT}/wave8-cart-with-item-pc.png`;
  await page.screenshot({ path: out, fullPage: true });
  console.log(`cart-with-item  pc  -> ${out}`);
  await page.close();
} catch (e) { console.log("cart-item flow error (ignored):", e.message); }
await browser.close();
console.log("DONE");
