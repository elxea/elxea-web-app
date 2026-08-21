// Wave 7: 同一 DOM 上で --color-muted を旧値/新値に切り替えた A/B 対照実測。
// 「旧値では hover が不可視だった」ことを同条件で証明する。
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hex2rgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").substr(i, 2), 16) / 255);
const rgb2hex = (a) => "#" + a.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const lum = ([r, g, b]) => 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
const cr = (h1, h2) => { const a = lum(hex2rgb(h1)), b = lum(hex2rgb(h2)); const [x, y] = a > b ? [a, b] : [b, a]; return (x + 0.05) / (y + 0.05); };
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
function lab2hex(L, A, B) {
  const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
  const f = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : ((116 * t - 16) / 24389) * 27);
  const X = f(fx) * 0.9642956764295677, Y = (L > 8 ? ((L + 16) / 116) ** 3 : L / (24389 / 27)), Z = f(fz) * 0.8251046025104602;
  return rgb2hex([
    3.1341359569958707 * X - 1.6173863321612538 * Y - 0.4906619460083532 * Z,
    -0.978795502912089 * X + 1.916254567259524 * Y + 0.03344287339036356 * Z,
    0.07195537988411677 * X - 0.2289768264158322 * Y + 1.405386058324125 * Z,
  ].map((v) => Math.min(1, Math.max(0, l2s(v)))));
}
function oklch2hex(L, C, H) {
  const h = (H * Math.PI) / 180, A = C * Math.cos(h), B2 = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B2) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B2) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B2) ** 3;
  return rgb2hex([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, l2s(v)))));
}
const toHex = (css) => {
  if (!css) return null;
  let m = css.match(/^rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:,?\s*([\d.]+))?/);
  if (m) return m[4] !== undefined && +m[4] === 0 ? "transparent" : rgb2hex([+m[1] / 255, +m[2] / 255, +m[3] / 255]);
  m = css.match(/^lab\(([-\d.]+)%?\s+([-\d.]+)\s+([-\d.]+)/);
  if (m) return lab2hex(+m[1], +m[2], +m[3]);
  m = css.match(/^oklch\(([\d.]+)%?\s+([\d.]+)\s+([-\d.]+)/);
  if (m) return oklch2hex(+m[1], +m[2], +m[3]);
  return css;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(BASE + "/ja/subscription", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);

const SEL = "a[href='#plan']"; // cream 背景上の hover:bg-muted (B2 と同一構図)
const rows = [];
for (const [arm, val] of [["BEFORE (旧 cream)", "oklch(0.933 0.012 96.4)"], ["AFTER (Figma 正)", "oklch(0.893 0.018 99.0)"]]) {
  await page.evaluate((v) => document.documentElement.style.setProperty("--color-muted", v), val);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const loc = page.locator(SEL).first();
  await loc.scrollIntoViewIfNeeded();
  const parent = await loc.evaluate((e) => {
    let p = e.parentElement;
    while (p) { const c = getComputedStyle(p).backgroundColor; if (c && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(c)) return c; p = p.parentElement; }
    return getComputedStyle(document.body).backgroundColor;
  });
  await loc.hover({ force: true });
  await page.waitForTimeout(500);
  const hov = await loc.evaluate((e) => getComputedStyle(e).backgroundColor);
  const P = toHex(parent), H = toHex(hov);
  rows.push({ arm, parent_bg: P, hover_bg: H, contrast: +cr(H, P).toFixed(4), visible: H !== P });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
}

// DateRibbon (静止 bg-muted) も同様に A/B
const rows2 = [];
for (const [arm, val] of [["BEFORE (旧 cream)", "oklch(0.933 0.012 96.4)"], ["AFTER (Figma 正)", "oklch(0.893 0.018 99.0)"]]) {
  await page.evaluate((v) => document.documentElement.style.setProperty("--color-muted", v), val);
  await page.waitForTimeout(300);
  const loc = page.locator("[data-slot='date-ribbon']").first();
  const parent = await loc.evaluate((e) => getComputedStyle(e.parentElement).backgroundColor || getComputedStyle(document.body).backgroundColor);
  const bg = await loc.evaluate((e) => getComputedStyle(e).backgroundColor);
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const P = toHex(parent) === "transparent" ? toHex(bodyBg) : toHex(parent);
  const B = toHex(bg);
  rows2.push({ arm, parent_bg: P, ribbon_bg: B, contrast: +cr(B, P).toFixed(4), visible: B !== P });
}

await browser.close();
console.log("## A/B 対照: subscription heroCta (cream 背景上の hover:bg-muted) — B2 と同一構図\n");
console.table(rows);
console.log("\n## A/B 対照: subscription DateRibbon (静止 bg-muted の pill)\n");
console.table(rows2);
