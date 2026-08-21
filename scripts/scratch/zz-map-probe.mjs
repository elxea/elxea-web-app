import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const PATH = process.env.MAPPATH || "/dev/origin-map?tea=10101";
const OUT = process.env.OUT || "/tmp/roji-map-check";
const VIEW = process.env.VIEW || "pc";

// site_auth cookie = HMAC-SHA256(key=password, msg=password)
const pw = (fs.readFileSync("/Users/setaka/github/elxea/products/elxea-web-app/.env.local", "utf8")
  .split("\n").find((l) => l.startsWith("SITE_PASSWORD=")) || "").split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
const cookieVal = pw ? crypto.createHmac("sha256", pw).update(pw).digest("hex") : null;

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({
  viewport: VIEW === "sp" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  isMobile: VIEW === "sp",
});
if (cookieVal) {
  await ctx.addCookies([{ name: "site_auth", value: cookieVal, domain: "localhost", path: "/" }]);
}
const page = await ctx.newPage();

const console_ = [];
const pageErrors = [];
const requests = [];
page.on("console", (m) => console_.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => pageErrors.push(String(e && e.stack ? e.stack.split("\n").slice(0, 6).join(" | ") : e)));
page.on("requestfailed", (r) => requests.push({ url: r.url(), failed: true, err: r.failure()?.errorText }));
page.on("response", (r) => {
  const u = r.url();
  if (/geo|maplibre|worker/.test(u)) requests.push({ url: u, status: r.status(), ct: r.headers()["content-type"] });
});

const resp = await page.goto(BASE + PATH, { waitUntil: "load", timeout: 60000 });
console.log("NAV status:", resp?.status(), "final url:", page.url());

await page.waitForTimeout(7000);

const probe = await page.evaluate(() => {
  const frame = document.querySelector('[data-slot="origin-map-frame"]');
  const mapEl = document.querySelector('[data-slot="origin-map"]');
  const canvas = document.querySelector("canvas");
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) }; };
  let px = null;
  if (canvas) {
    try {
      const c2 = document.createElement("canvas");
      c2.width = canvas.width; c2.height = canvas.height;
      c2.getContext("2d").drawImage(canvas, 0, 0);
      const d = c2.getContext("2d").getImageData(0, 0, c2.width, c2.height).data;
      const counts = new Map();
      for (let i = 0; i < d.length; i += 4 * 37) {
        const k = `${d[i]},${d[i+1]},${d[i+2]},${d[i+3]}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      px = { distinct: counts.size, top: [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5) };
    } catch (e) { px = { error: String(e) }; }
  }
  const marker = document.querySelector(".maplibregl-marker");
  return {
    frame: r(frame),
    frameHtmlLen: frame ? frame.innerHTML.length : null,
    mapEl: r(mapEl),
    canvas: canvas ? { ...r(canvas), attrW: canvas.width, attrH: canvas.height } : null,
    canvasPx: px,
    marker: marker ? { rect: r(marker), transform: getComputedStyle(marker).transform } : null,
    maplibreCssLoaded: !!getComputedStyle(document.documentElement).getPropertyValue("--x") || Array.from(document.styleSheets).some((s) => { try { return Array.from(s.cssRules).some((r) => r.selectorText && r.selectorText.includes("maplibregl-canvas")); } catch { return false; } }),
    bodyText: (document.body.innerText || "").slice(0, 300),
  };
});

console.log("PROBE:", JSON.stringify(probe, null, 2));
console.log("PAGE ERRORS:", JSON.stringify(pageErrors, null, 2));
console.log("CONSOLE:", JSON.stringify(console_.slice(0, 40).map((x) => x.slice(0, 400)), null, 2));
console.log("NET(geo/maplibre):", JSON.stringify(requests, null, 2));

await page.screenshot({ path: `${OUT}/${VIEW}-${process.env.TAG || "probe"}.png`, fullPage: false });
await browser.close();
