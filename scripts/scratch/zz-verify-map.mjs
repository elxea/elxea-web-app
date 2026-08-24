// 本番の産地地図が実際に描画されているかを確認する。
// パスワードは環境変数 SITE_PW から読む (argv に載せない)。
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "https://elxea.com";
const PW = process.env.SITE_PW;
const OUT = process.env.OUT_DIR;
const TARGET = process.env.TARGET_PATH || "/dev/origin-map?tea=10101";
const TAG = process.env.TAG || "shot";
if (!PW) throw new Error("SITE_PW missing");

// headless Chromium は既定で WebGL2 を持たない。maplibre は WebGL2 必須なので
// SwiftShader (CPU 実装) を明示的に有効化する。これが無いと GPUInitializationError で
// 本番のバグと区別が付かなくなる。
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 220)); });
page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e).slice(0, 220)));
page.on("requestfailed", (r) => errs.push(`REQFAIL ${r.url().replace(BASE, "").slice(0, 120)} ${r.failure()?.errorText}`));

const authRes = await ctx.request.post(`${BASE}/api/site-auth`, { data: { password: PW } });
console.log(`[gate] auth -> ${authRes.status()}`);

// WebGL2 が本当に効いているか先に確かめる
const probe = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  return { webgl2: !!gl, renderer: gl ? gl.getParameter(gl.getParameter ? 0x1f01 : 0) : null };
}).catch(() => ({ webgl2: false }));
console.log(`[env] webgl2=${probe.webgl2} renderer=${probe.renderer}`);

const res = await page.goto(BASE + TARGET, { waitUntil: "networkidle", timeout: 90000 });
console.log(`[page] ${TARGET} -> http=${res.status()}`);

// 地図の描画完了 (idle) を待つ
await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(8000);

const state = await page.evaluate(() => {
  const c = document.querySelector(".maplibregl-canvas");
  const r = c?.getBoundingClientRect();
  return {
    block: !!document.querySelector('[data-slot="tea-origin-block"]'),
    canvas: document.querySelectorAll(".maplibregl-canvas").length,
    markers: document.querySelectorAll(".maplibregl-marker").length,
    canvasSize: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
    bodyText: document.body.innerText.slice(0, 200),
  };
});
console.log(`[state] ${JSON.stringify(state)}`);

// 真っ白判定: WebGL のバックバッファを読み、色の種類数を数える。
// 陸・海・県境が描かれていれば色は多数、真っ白なら 1〜2 種類に落ちる。
const px = await page.evaluate(() => {
  const c = document.querySelector(".maplibregl-canvas");
  if (!c) return { ok: false, why: "no canvas" };
  const gl = c.getContext("webgl2", { preserveDrawingBuffer: true });
  if (!gl) return { ok: false, why: "no webgl2 ctx" };
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const seen = new Map();
  let step = 4 * 13;
  for (let i = 0; i < buf.length; i += step) {
    const k = `${buf[i] >> 4},${buf[i + 1] >> 4},${buf[i + 2] >> 4}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const sorted = [...seen.entries()].sort((a, b) => b[1] - a[1]);
  const total = [...seen.values()].reduce((a, b) => a + b, 0);
  return {
    ok: true, w, h,
    distinctColors: seen.size,
    topShare: total ? +(sorted[0][1] / total).toFixed(4) : null,
    top5: sorted.slice(0, 5).map(([k, v]) => ({ c: k, pct: +(v / total * 100).toFixed(1) })),
  };
});
console.log(`[pixels] ${JSON.stringify(px)}`);

await page.screenshot({ path: `${OUT}/${TAG}-full.` + "png", fullPage: true });
const map = page.locator(".maplibregl-map").first();
if (await map.count()) await map.screenshot({ path: `${OUT}/${TAG}-map.` + "png" });
const blk = page.locator('[data-slot="tea-origin-block"]').first();
if (await blk.count()) await blk.screenshot({ path: `${OUT}/${TAG}-block.` + "png" });

console.log(`[errors] ${errs.length}`);
errs.slice(0, 10).forEach((e) => console.log("  ! " + e));
fs.writeFileSync(`${OUT}/${TAG}-result.json`, JSON.stringify({ BASE, TARGET, probe, state, px, errs: errs.slice(0, 20) }, null, 2));
await browser.close();
console.log("DONE");
