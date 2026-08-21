import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3300";
const MAPPATH = process.env.MAPPATH || "/dev/origin-map?tea=10101";
const OUT = process.env.OUT || "/tmp/roji-map-fixed";
const VIEW = process.env.VIEW || "pc";
const TAG = process.env.TAG || "probe";

fs.mkdirSync(OUT, { recursive: true });

const pw = (fs
  .readFileSync("/Users/setaka/github/elxea/products/elxea-web-app/.env.local", "utf8")
  .split("\n")
  .find((l) => l.startsWith("SITE_PASSWORD=")) || "")
  .split("=")
  .slice(1)
  .join("=")
  .trim()
  .replace(/^["']|["']$/g, "");
const cookieVal = pw ? crypto.createHmac("sha256", pw).update(pw).digest("hex") : null;

const GL = process.env.GL === "1";
const browser = await chromium.launch({
  args: GL
    ? [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--enable-webgl",
      ]
    : [],
});
const ctx = await browser.newContext({
  viewport: VIEW === "sp" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  isMobile: VIEW === "sp",
});
if (cookieVal) {
  await ctx.addCookies([{ name: "site_auth", value: cookieVal, domain: "localhost", path: "/" }]);
}

// --- instrumentation injected BEFORE any page script runs ---
await ctx.addInitScript(() => {
  const w = window;
  w.__probe = { workers: [], workerErrors: [], workerMsgErrors: [] };
  const NativeWorker = w.Worker;
  w.Worker = function (url, opts) {
    const rec = { url: String(url), opts: opts ? JSON.parse(JSON.stringify(opts)) : null, ts: Date.now() };
    // if it is a blob URL, try to read its contents synchronously via XHR
    if (String(url).startsWith("blob:")) {
      try {
        const x = new XMLHttpRequest();
        x.open("GET", String(url), false);
        x.send();
        rec.blobBody = x.responseText.slice(0, 500);
      } catch (e) {
        rec.blobBody = "READ_FAIL " + String(e);
      }
    }
    w.__probe.workers.push(rec);
    const inst = new NativeWorker(url, opts);
    inst.addEventListener("error", (e) => {
      w.__probe.workerErrors.push({
        url: String(url),
        message: e.message || null,
        filename: e.filename || null,
        lineno: e.lineno ?? null,
      });
    });
    inst.addEventListener("messageerror", (e) => {
      w.__probe.workerMsgErrors.push({ url: String(url), type: String(e && e.type) });
    });
    return inst;
  };
  w.Worker.prototype = NativeWorker.prototype;
});

const page = await ctx.newPage();
const consoleLines = [];
const pageErrors = [];
const netFailed = [];
const netInteresting = [];
page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on("pageerror", (e) => pageErrors.push(String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e).slice(0, 500)));
page.on("requestfailed", (r) => netFailed.push({ url: r.url(), err: r.failure()?.errorText }));
page.on("response", (r) => {
  const u = r.url();
  if (/geo\/|worker|maplibre/i.test(u)) {
    netInteresting.push({ url: u, status: r.status(), ct: r.headers()["content-type"] || null });
  }
});

const resp = await page.goto(BASE + MAPPATH, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);

const probe = await page.evaluate(async () => {
  const w = window;
  const map = w.__originMap;
  const out = { probe: w.__probe, mapPresent: !!map };
  if (!map) return out;
  out.mapLog = (w.__originMapLog || []).slice(0, 60);
  out.isStyleLoaded = map.isStyleLoaded();
  out.loaded = map.loaded();
  try {
    const style = map.getStyle();
    out.styleKeys = Object.keys(style);
    out.styleSources = Object.keys(style.sources || {});
    out.styleLayers = (style.layers || []).map((l) => ({ id: l.id, type: l.type, source: l.source || null }));
  } catch (e) {
    out.styleErr = String(e);
  }
  out.sources = {};
  for (const id of ["jp-land", "jp-pref"]) {
    const src = map.getSource(id);
    out.sources[id] = src
      ? {
          type: src.type,
          isSourceLoaded: map.isSourceLoaded(id),
          data: typeof src._data === "string" ? src._data : typeof src._data,
        }
      : null;
  }
  out.rendered = {};
  for (const id of ["land", "coastline", "pref-border"]) {
    try {
      out.rendered[id] = map.queryRenderedFeatures({ layers: [id] }).length;
    } catch (e) {
      out.rendered[id] = "ERR " + String(e).slice(0, 120);
    }
  }
  out.srcFeatures = {};
  for (const id of ["jp-land", "jp-pref"]) {
    try {
      out.srcFeatures[id] = map.querySourceFeatures(id).length;
    } catch (e) {
      out.srcFeatures[id] = "ERR " + String(e).slice(0, 120);
    }
  }
  out.canvasSize = { w: map.getCanvas().width, h: map.getCanvas().height };
  out.center = map.getCenter();
  out.zoom = map.getZoom();
  return out;
});

// canvas pixel histogram
const px = await page.evaluate(() => {
  const c = document.querySelector('[data-slot="origin-map"] canvas');
  if (!c) return null;
  const c2 = document.createElement("canvas");
  c2.width = c.width;
  c2.height = c.height;
  const g = c2.getContext("2d");
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, c2.width, c2.height).data;
  const counts = new Map();
  for (let i = 0; i < d.length; i += 4 * 13) {
    const k = `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return { distinct: counts.size, top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) };
});

const report = {
  tag: TAG,
  view: VIEW,
  navStatus: resp?.status(),
  finalUrl: page.url(),
  net: netInteresting,
  netFailed,
  pageErrors,
  consoleErrors: consoleLines.filter((l) => /error|warn/i.test(l)).slice(0, 20),
  probe,
  pixels: px,
};
fs.writeFileSync(`${OUT}/${TAG}-${VIEW}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2).slice(0, 9000));

const frame = page.locator('[data-slot="origin-map-frame"]').first();
if (await frame.count()) {
  await frame.screenshot({ path: `${OUT}/${TAG}-${VIEW}-mapcrop.png` });
}
await page.screenshot({ path: `${OUT}/${TAG}-${VIEW}-full.png`, fullPage: true });

await browser.close();
