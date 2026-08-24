import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ja-JP" });
const page = await ctx.newPage();

const targets = [
  ["01 journal list", "/ja/journal"],
  ["02 journal article", "/ja/journal/tea-culture-around-the-world"],
  ["03 tea-menu detail", "/ja/tea-menu/uji-gyokuro"],
  ["04 theme akane", "/ja/zz-wash-probe?theme=akane"],
  ["04b theme sui", "/ja/zz-wash-probe?theme=sui"],
  ["04c theme sohi", "/ja/zz-wash-probe?theme=sohi"],
  ["05 farmers detail", "/ja/farmers/sato-misaki"],
  ["06 cart", "/ja/cart"],
];

for (const [label, path] of targets) {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(3500);
  const res = await page.evaluate(() => {
    // computed value は oklch(...) で返るので canvas に塗って sRGB へ落とす
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    const parse = (s) => {
      pctx.clearRect(0, 0, 1, 1);
      pctx.fillStyle = "#000";
      pctx.fillStyle = s;
      pctx.fillRect(0, 0, 1, 1);
      const d = pctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const bg = parse(getComputedStyle(document.body).backgroundColor);
    // 本文の実効文字色: prose 内の p、無ければ body
    const textEl = document.querySelector("main p, article p, main h1") ?? document.body;
    const fg = parse(getComputedStyle(textEl).color);

    const el = document.querySelector('[data-testid="roji-reading-wash"]');
    const cv = el?.querySelector("canvas");

    const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };

    if (!cv) {
      return { wash: false, fg, bg, min: ratio(fg, bg), max: ratio(fg, bg) };
    }

    // ビューポート内、本文が乗る帯 (x 440-1560/2 相当) をグリッドで走査
    const g2 = document.createElement("canvas");
    g2.width = cv.width; g2.height = cv.height;
    const g = g2.getContext("2d");
    g.drawImage(cv, 0, 0);
    const data = g.getImageData(0, 0, cv.width, cv.height).data;

    const ratios = [];
    const samples = [];
    for (let vy = 200; vy < 780; vy += 20) {
      for (let vx = 200; vx < 1100; vx += 20) {
        const cx = Math.floor((vx / window.innerWidth) * cv.width);
        const cy = Math.floor((vy / window.innerHeight) * cv.height);
        const i = (cy * cv.width + cx) * 4;
        const a = data[i + 3] / 255;
        // 面を紙 (body 背景) の上に合成
        const comp = [0, 1, 2].map((k) => data[i + k] * a + bg[k] * (1 - a));
        ratios.push(ratio(fg, comp));
        samples.push(comp.map(Math.round));
      }
    }
    ratios.sort((a, b) => a - b);
    return {
      wash: true,
      theme: el.getAttribute("data-roji-theme"),
      fg: fg.slice(0, 3),
      paper: bg.slice(0, 3),
      paperRatio: ratio(fg, bg),
      min: ratios[0],
      p05: ratios[Math.floor(ratios.length * 0.05)],
      median: ratios[Math.floor(ratios.length / 2)],
      max: ratios[ratios.length - 1],
      n: ratios.length,
      darkestBg: samples[0],
    };
  });
  const f = (x) => (typeof x === "number" ? x.toFixed(2) : x);
  console.log(
    label.padEnd(20),
    JSON.stringify({ ...res, paperRatio: f(res.paperRatio), min: f(res.min), p05: f(res.p05), median: f(res.median), max: f(res.max) }),
  );
}
await browser.close();
