import { chromium } from "@playwright/test";
const browser = await chromium.launch();
for (const [w,h] of [[1440,900],[375,812]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:3187/ja/journal", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  console.log(w, JSON.stringify(await page.evaluate(() => {
    const s = document.querySelector('[data-slot="catalog-sort"]');
    const cs = s ? getComputedStyle(s) : null;
    const r = s ? s.getBoundingClientRect() : null;
    return s ? { display: cs.display, w: +r.width.toFixed(2), h: +r.height.toFixed(2), borderRadius: cs.borderRadius, optionCount: s.options.length, value: s.value } : "absent";
  })));
  await ctx.close();
}
await browser.close();
