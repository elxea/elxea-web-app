import { chromium } from "playwright";
const BASE = "https://elxea.com", PW = process.env.SITE_PW;
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.request.post(`${BASE}/api/site-auth`, { data: { password: PW } });
const p = await ctx.newPage();
for (const u of ["/ja/tea-menu/spring-sencha", "/dev/origin-map", "/ja/dev/origin-map"]) {
  const r = await p.goto(BASE + u, { waitUntil: "networkidle", timeout: 60000 }).catch(e => ({ status: () => "ERR " + e.message.slice(0,60) }));
  const info = await p.evaluate(() => ({
    block: !!document.querySelector('[data-slot="tea-origin-block"]'),
    canvas: document.querySelectorAll(".maplibregl-canvas").length,
    marker: document.querySelectorAll(".maplibregl-marker").length,
    h2: [...document.querySelectorAll("h1,h2")].map(h=>h.textContent.trim()).slice(0,8),
  })).catch(() => null);
  console.log(`${u} -> http=${r.status()} final=${p.url().replace(BASE,"")} ${JSON.stringify(info)}`);
}
// tea-menu の Sanity productNumber を確認
const r2 = await ctx.request.get(`${BASE}/ja/tea-menu/spring-sencha`);
const html = await r2.text();
console.log(`[html] tea-origin-block in HTML: ${html.includes("tea-origin-block")}`);
console.log(`[html] productNumber occurrences: ${(html.match(/productNumber/g)||[]).length}`);
await b.close();
