import pw from "/Users/setaka/github/elxea/products/elxea-web-app/node_modules/playwright/index.js";
const { chromium } = pw;
import { readFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:3300";
const OUT = "/tmp/roji-map-final2";
mkdirSync(OUT, { recursive: true });
const cookie = readFileSync("/tmp/roji-cookie.txt", "utf8").trim();

const PC = { width: 1440, height: 900 };
const SP = { width: 390, height: 844 };

const shots = [
  { name: "01-tea-menu-pc", url: "/dev/origin-map?tea=10101", vp: PC, map: true },
  { name: "02-tea-menu-sp", url: "/dev/origin-map?tea=10101", vp: SP, map: true },
  { name: "03-tsushima", url: "/dev/origin-map?tea=51001", vp: PC, map: true },
  { name: "03b-tsushima-sp", url: "/dev/origin-map?tea=51001", vp: SP, map: true },
  { name: "04-no-origin", url: "/ja/tea-menu/uji-gyokuro", vp: PC, map: false },
  { name: "04b-no-origin-sp", url: "/ja/tea-menu/uji-gyokuro", vp: SP, map: false },
];

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
await ctx.addCookies([
  { name: "site_auth", value: cookie, domain: "localhost", path: "/" },
]);

for (const s of shots) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  await page.setViewportSize(s.vp);
  await page.goto(BASE + s.url, { waitUntil: "networkidle", timeout: 60000 });

  // The map frame lazy-mounts on intersection, so scroll it into view first.
  const block = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="tea-origin-block"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: r.height, text: el.innerText };
  });
  if (block) {
    await page.evaluate((t) => window.scrollTo(0, Math.max(0, t - 80)), block.top);
    await page.waitForTimeout(600);
  }

  let painted = null;
  if (s.map) {
    await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30000 });
    await page
      .waitForFunction(
        () => {
          const c = document.querySelector("canvas.maplibregl-canvas");
          if (!c || !c.width) return false;
          const gl = c.getContext("webgl2") || c.getContext("webgl");
          if (!gl) return false;
          const px = new Uint8Array(4 * c.width);
          gl.readPixels(0, Math.floor(c.height / 2), c.width, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let opaque = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] > 0) opaque++;
          return opaque > 0;
        },
        { timeout: 30000 },
      )
      .catch(() => {});
    painted = await page.evaluate(() => {
      const c = document.querySelector("canvas.maplibregl-canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      const px = new Uint8Array(4 * c.width * 8);
      gl.readPixels(0, Math.floor(c.height / 2) - 4, c.width, 8, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let opaque = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) opaque++;
      return { w: c.width, h: c.height, opaqueSamples: opaque, total: px.length / 4 };
    });
    await page.waitForTimeout(2500);
    await page.evaluate((t) => window.scrollTo(0, Math.max(0, t - 80)), block.top);
    await page.waitForTimeout(800);
  }

  await page.screenshot({ path: `${OUT}/${s.name}.png` });

  // Also crop the map frame itself so the render can be judged at pixel level.
  const frame = await page.$('[data-slot="origin-map-frame"]');
  if (frame) {
    await frame.screenshot({ path: `${OUT}/${s.name}-mapcrop.png` });
  }

  console.log(
    JSON.stringify({ name: s.name, url: s.url, vp: s.vp, painted, block, errors: errors.slice(0, 6) }),
  );
  await page.close();
}

await browser.close();
