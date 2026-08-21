import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/tmp/roji-reading-verify";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  locale: "ja-JP",
});
const page = await ctx.newPage();

async function settle(ms = 3500) {
  await page.waitForTimeout(ms);
}

/** wash が居るか + canvas の平均色 (テーマ差の客観指標) */
async function washInfo() {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="roji-reading-wash"]');
    if (!el) return { present: false };
    const canvas = el.querySelector("canvas");
    const info = {
      present: true,
      theme: el.getAttribute("data-roji-theme"),
      hasCanvas: !!canvas,
      rect: el.getBoundingClientRect().toJSON(),
      position: getComputedStyle(el).position,
      zIndex: getComputedStyle(el).zIndex,
    };
    if (canvas) {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 40;
      const g = c.getContext("2d");
      g.drawImage(canvas, 0, 0, 64, 40);
      const d = g.getImageData(0, 0, 64, 40).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
      info.meanRGB = [Math.round(r / n), Math.round(gg / n), Math.round(b / n)];
      info.canvasSize = { w: canvas.width, h: canvas.height };
    }
    return info;
  });
}

const report = {};

async function shot(name, url, opts = {}) {
  await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 90000 });
  await settle(opts.wait ?? 3500);
  if (opts.scrollTo) {
    await page.evaluate((y) => window.scrollTo(0, y), opts.scrollTo);
    await settle(1500);
  }
  const info = await washInfo();
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file });
  report[name] = { url, ...info };
  console.log(name, url, JSON.stringify(info));
  return file;
}

// 長い記事を選ぶ
await page.goto(BASE + "/ja/journal", { waitUntil: "networkidle", timeout: 90000 });
await settle(2000);
const slugs = await page.$$eval("main a[href^='/ja/journal/']", (as) =>
  Array.from(new Set(as.map((a) => a.getAttribute("href")))).filter(
    (h) => h.split("/").length === 4,
  ),
);
let longest = { slug: slugs[0], len: 0 };
for (const s of slugs.slice(0, 12)) {
  await page.goto(BASE + s, { waitUntil: "networkidle", timeout: 90000 });
  const len = await page.evaluate(() => document.body.innerText.length);
  if (len > longest.len) longest = { slug: s, len };
}
console.log("longest article:", JSON.stringify(longest));

await shot("01-journal-list", "/ja/journal");
await shot("02-journal-article", longest.slug);
await shot("03-tea-menu-detail", "/ja/tea-menu/uji-gyokuro");
await shot("04-elxea-journal-article", "/ja/zz-wash-probe?theme=akane");
await shot("04b-elxea-journal-sui", "/ja/zz-wash-probe?theme=sui");
await shot("04c-elxea-journal-sohi", "/ja/zz-wash-probe?theme=sohi");
await shot("04d-elxea-journal-list-empty", "/ja/elxea-journal");
await shot("05-farmers-detail", "/ja/farmers/sato-misaki");
await shot("06-cart-excluded", "/ja/cart");

// --- スクロール干渉 (Lenis) 検証: 長い記事で上部・中部・下部 ---
await page.goto(BASE + longest.slug, { waitUntil: "networkidle", timeout: 90000 });
await settle(3500);
const h = await page.evaluate(() => document.documentElement.scrollHeight);
console.log("scrollHeight", h);
const points = [
  ["07-scroll-top", 0],
  ["08-scroll-mid", Math.round((h - 800) / 2)],
  ["09-scroll-bottom", h - 900],
];
for (const [name, y] of points) {
  // Lenis を通す: ホイールで動かしてから慣性が止まるまで待つ
  await page.evaluate(async (target) => {
    window.scrollTo({ top: target, behavior: "smooth" });
  }, y);
  await settle(2500);
  const st = await page.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    rect: document
      .querySelector('[data-testid="roji-reading-wash"]')
      ?.getBoundingClientRect()
      .toJSON(),
  }));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  report[name] = { y, ...st };
  console.log(name, JSON.stringify(st));
}

// ホイール実操作でのちらつき確認 (連続スクロール中の rect 変動)
await page.evaluate(() => window.scrollTo(0, 0));
await settle(1000);
const drift = [];
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(120);
  drift.push(
    await page.evaluate(() => {
      const r = document
        .querySelector('[data-testid="roji-reading-wash"]')
        ?.getBoundingClientRect();
      return r ? [Math.round(r.top), Math.round(r.left), Math.round(r.height)] : null;
    }),
  );
}
report.wheelDrift = drift;
console.log("wheelDrift", JSON.stringify(drift));

fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log("DONE");
