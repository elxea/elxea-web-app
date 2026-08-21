// Wave 7: muted トークン是正の runtime 検証。
// 実ブラウザで hover / active を発火させ getComputedStyle の背景色を実測する。
// (scripts/scratch は gitignored / 使い捨て)
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";

// ---- sRGB / CIE Lab 変換 (自前・外部依存なし) ----
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hex2rgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").substr(i, 2), 16) / 255);
const rgb2hex = (a) => "#" + a.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const lum = ([r, g, b]) => 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
const crHex = (h1, h2) => {
  const a = lum(hex2rgb(h1)), b = lum(hex2rgb(h2));
  const [x, y] = a > b ? [a, b] : [b, a];
  return (x + 0.05) / (y + 0.05);
};
function lab2hex(L, A, B) {
  const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
  const f = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : ((116 * t - 16) / 24389) * 27);
  const [Xn, Yn, Zn] = [0.9642956764295677, 1, 0.8251046025104602];
  const X = f(fx) * Xn;
  const Y = (L > 8 ? ((L + 16) / 116) ** 3 : L / (24389 / 27)) * Yn;
  const Z = f(fz) * Zn;
  const R = 3.1341359569958707 * X - 1.6173863321612538 * Y - 0.4906619460083532 * Z;
  const G = -0.978795502912089 * X + 1.916254567259524 * Y + 0.03344287339036356 * Z;
  const Bl = 0.07195537988411677 * X - 0.2289768264158322 * Y + 1.405386058324125 * Z;
  return rgb2hex([R, G, Bl].map((v) => Math.min(1, Math.max(0, l2s(v)))));
}
function toHex(css) {
  if (!css) return null;
  let m = css.match(/^rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:,?\s*([\d.]+))?/);
  if (m) {
    if (m[4] !== undefined && +m[4] === 0) return "transparent";
    return rgb2hex([+m[1] / 255, +m[2] / 255, +m[3] / 255]);
  }
  m = css.match(/^lab\(([-\d.]+)%?\s+([-\d.]+)\s+([-\d.]+)/);
  if (m) return lab2hex(+m[1], +m[2], +m[3]);
  return css;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const out = { tokens: {}, targets: [], notes: [] };

// ---------- 1. :root トークン実測 ----------
await page.goto(BASE + "/ja/subscription", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);

out.tokens = await page.evaluate(() => {
  const probe = (cls) => {
    const el = document.createElement("div");
    el.className = cls;
    el.style.cssText = "position:fixed;left:-9999px;width:10px;height:10px";
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const v = { bg: cs.backgroundColor, color: cs.color };
    el.remove();
    return v;
  };
  return {
    "bg-muted": probe("bg-muted"),
    "bg-background": probe("bg-background"),
    "bg-card": probe("bg-card"),
    "bg-secondary": probe("bg-secondary"),
    "bg-muted+text-muted-foreground": probe("bg-muted text-muted-foreground"),
    "skeleton bg-muted": probe("animate-pulse rounded-sm bg-muted"),
    "pill disabled:bg-muted": probe("bg-muted text-muted-foreground"),
  };
});
for (const k of Object.keys(out.tokens))
  out.tokens[k] = { bg: toHex(out.tokens[k].bg), fg: toHex(out.tokens[k].color) };

// ---------- 2. 実 hover / active 測定 ----------
async function measure(label, selector, { active = true, path } = {}) {
  if (path) {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1000);
  }
  const loc = page.locator(selector).first();
  const n = await page.locator(selector).count();
  if (n === 0) { out.targets.push({ label, selector, found: 0, skipped: "要素なし" }); return; }
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(200);

  const parentBg = await loc.evaluate((e) => {
    let p = e.parentElement;
    while (p) {
      const c = getComputedStyle(p).backgroundColor;
      if (c && !/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(c)) return c;
      p = p.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
  const rest = await loc.evaluate((e) => getComputedStyle(e).backgroundColor);
  await loc.hover({ force: true });
  await page.waitForTimeout(450);
  const hover = await loc.evaluate((e) => getComputedStyle(e).backgroundColor);
  let act = null;
  if (active) {
    const box = await loc.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(450);
      act = await loc.evaluate((e) => getComputedStyle(e).backgroundColor);
      await page.mouse.up();
    }
  }
  const P = toHex(parentBg), R = toHex(rest), H = toHex(hover), A = toHex(act);
  const eff = (v) => (v === "transparent" ? P : v);
  out.targets.push({
    label, found: n,
    parent_bg: P,
    rest: R, hover: H, active: A,
    cr_rest_vs_parent: +crHex(eff(R), P).toFixed(4),
    cr_hover_vs_parent: +crHex(eff(H), P).toFixed(4),
    cr_active_vs_parent: A ? +crHex(eff(A), P).toFixed(4) : null,
    hover_visible: eff(H) !== P,
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

// subscription: hero CTA は「cream 背景の上の hover:bg-muted」= B2 と同じ構図
await measure("subscription heroCta a[href='#plan'] hover:bg-muted (cream 背景上)", "a[href='#plan']");
await measure("subscription DateRibbon bg-muted 静止面", "[data-slot='date-ribbon']", { active: false });
await measure("subscription ImagePlaceholder bg-muted 静止面", "div.bg-muted.overflow-hidden", { active: false });
// membership: bg-muted 静止 + hover:bg-muted/80 + active:bg-muted/70
await measure("membership Button bg-muted hover:/80 active:/70", "a.bg-muted", { path: "/ja/membership" });
await measure("membership chip rounded-full bg-muted 静止面", "span.bg-muted", { active: false });

// audio-block / SoundCloud の描画有無 (B2 本体)
for (const p of ["/ja/elxea-journal", "/ja/journal", "/ja/playlists"]) {
  try {
    await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(900);
    const ab = await page.locator("[data-slot='audio-block']").count();
    const sc = await page.locator("a[href*='soundcloud']").count();
    const rr = await page.locator("[data-slot='reading-row']").count();
    out.notes.push(`${p}: audio-block=${ab} soundcloud=${sc} reading-row=${rr}`);
  } catch (e) { out.notes.push(`${p}: ${String(e).split("\n")[0]}`); }
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
