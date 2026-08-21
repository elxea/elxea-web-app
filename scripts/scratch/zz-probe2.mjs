import { chromium } from "playwright";
const BASE = process.env.BASE_URL || "https://elxea.com", PW = process.env.SITE_PW;
const OUT = process.env.OUT_DIR;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await ctx.request.post(`${BASE}/api/site-auth`, { data: { password: PW } });

// worker asset が本番で配られているか (build 時の複製が走ったかの直接証拠)
for (const a of ["/maplibre/maplibre-gl-worker.mjs"]) {
  const r = await ctx.request.get(BASE + a);
  console.log(`[asset] ${a} -> ${r.status()} len=${(await r.body()).length} ct=${r.headers()["content-type"]}`);
}

const p = await ctx.newPage();
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
p.on("pageerror", (e) => errs.push("PAGEERROR " + String(e).slice(0, 300)));
p.on("requestfailed", (r) => errs.push(`REQFAIL ${r.url().replace(BASE, "").slice(0, 120)} ${r.failure()?.errorText}`));

const u = "/dev/origin-map?tea=10101";
const r = await p.goto(BASE + u, { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(6000);
const info = await p.evaluate(() => ({
  block: !!document.querySelector('[data-slot="tea-origin-block"]'),
  canvas: document.querySelectorAll(".maplibregl-canvas").length,
  marker: document.querySelectorAll(".maplibregl-marker").length,
  bodyText: document.body.innerText.slice(0, 300),
}));
console.log(`[page] ${u} -> http=${r.status()}`);
console.log(JSON.stringify(info, null, 1));
console.log("[errors]");
errs.slice(0, 12).forEach((e) => console.log("  ! " + e));
await p.screenshot({ path: OUT + "/dev-origin-map." + "png", fullPage: true });
await b.close();
