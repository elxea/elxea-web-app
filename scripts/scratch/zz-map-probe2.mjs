import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3300";
const PATH = process.env.MAPPATH || "/dev/origin-map?tea=10101";
const OUT = process.env.OUT || "/tmp/roji-map-check";
const VIEW = process.env.VIEW || "pc";
const TAG = process.env.TAG || "probe2";

const pw = (fs.readFileSync("/Users/setaka/github/elxea/products/elxea-web-app/.env.local", "utf8")
  .split("\n").find((l) => l.startsWith("SITE_PASSWORD=")) || "").split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
const cookieVal = pw ? crypto.createHmac("sha256", pw).update(pw).digest("hex") : null;

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({
  viewport: VIEW === "sp" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  isMobile: VIEW === "sp",
});
if (cookieVal) await ctx.addCookies([{ name: "site_auth", value: cookieVal, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();

const geoHits = [];
const workers = [];
const errs = [];
const warns = [];
// route interception catches worker-originated requests too
await page.route("**/geo/**", async (route) => {
  const r = route.request();
  const resp = await route.fetch().catch((e) => ({ __err: String(e) }));
  geoHits.push({ url: r.url(), from: r.frame() ? "page" : "worker", status: resp.status ? resp.status() : resp.__err });
  if (resp.__err) return route.abort();
  return route.fulfill({ response: resp });
});
page.on("worker", (w) => workers.push(w.url()));
page.on("pageerror", (e) => errs.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 300)); if (m.type() === "warning") warns.push(m.text().slice(0, 200)); });

await page.goto(BASE + PATH, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector('[data-slot="origin-map"]', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(8000);

const el = await page.$('[data-slot="origin-map-frame"]');
const shotPath = `${OUT}/${VIEW}-${TAG}-map.png`;
if (el) await el.screenshot({ path: shotPath });
await page.screenshot({ path: `${OUT}/${VIEW}-${TAG}-full.png`, fullPage: false });

// Analyse the *composited* screenshot (canvas readback is unreliable without preserveDrawingBuffer)
let shotStats = null;
if (el && fs.existsSync(shotPath)) {
  const b64 = fs.readFileSync(shotPath).toString("base64");
  shotStats = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const counts = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const total = d.length / 4;
    return {
      size: { w: c.width, h: c.height },
      distinct: counts.size,
      top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +(100 * v / total).toFixed(1) + "%"]),
    };
  }, b64);
}

const mapState = await page.evaluate(() => {
  const w = window;
  const m = w.__originMap;
  if (!m) return { exposed: false };
  const log = w.__originMapLog || [];
  return {
    exposed: true,
    isStyleLoaded: m.isStyleLoaded(),
    loaded: m.loaded(),
    sourcesLoaded: ["jp-land", "jp-pref"].map((id) => {
      let feats = -1;
      try { feats = m.querySourceFeatures(id).length; } catch (e) { feats = String(e).slice(0, 60); }
      return { id, isSourceLoaded: m.isSourceLoaded(id), feats };
    }),
    center: m.getCenter(), zoom: m.getZoom(),
    canvasSize: { w: m.getCanvas().width, h: m.getCanvas().height },
    layers: m.getStyle()?.layers?.map((l) => l.id),
    log: log.slice(0, 40),
  };
});

console.log("GEO REQUESTS:", JSON.stringify(geoHits, null, 1));
console.log("WORKERS:", JSON.stringify(workers, null, 1));
console.log("MAP STATE:", JSON.stringify(mapState, null, 1));
console.log("SHOT STATS:", JSON.stringify(shotStats, null, 1));
console.log("ERRORS:", JSON.stringify([...new Set(errs)], null, 1));
await browser.close();
