import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ja-JP" });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));

for (const p of ["/ja/journal/tea-culture-around-the-world", "/ja/zz-wash-probe?theme=sui", "/ja/cart"]) {
  logs.length = 0;
  await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(4000);
  console.log("===", p);
  console.log(logs.length ? logs.join("\n") : "(no console error/warning)");
}

// スクロール中の連続フレームで面がちらつかないか
await page.goto(BASE + "/ja/journal/tea-culture-around-the-world", { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
const samples = [];
for (let i = 0; i < 16; i++) {
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(80);
  samples.push(
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="roji-reading-wash"]');
      const cv = el?.querySelector("canvas");
      if (!cv) return null;
      const c = document.createElement("canvas");
      c.width = 16; c.height = 10;
      const g = c.getContext("2d");
      g.drawImage(cv, 0, 0, 16, 10);
      const d = g.getImageData(0, 0, 16, 10).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let k = 0; k < d.length; k += 4) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; }
      const r0 = el.getBoundingClientRect();
      return { mean: [Math.round(r / n), Math.round(gg / n), Math.round(b / n)], top: Math.round(r0.top), h: Math.round(r0.height), y: Math.round(window.scrollY) };
    }),
  );
}
console.log("=== scroll frames");
for (const s of samples) console.log(JSON.stringify(s));
await browser.close();
