/**
 * 本番でのカート初回追加の反応時間を測る (監査 P1-1 の前後比較)。
 *
 * 監査と同じ条件を作る:
 *   - まっさらなブラウザ文脈 (カートの cookie が無い = 1 個目は cartCreate を伴う)
 *   - SP 390x844
 *   - 押した瞬間 (t0) から、画面に変化が出るまでを performance.now() の差で測る
 *
 * 購入はしない。測ったあとカートから外して原状復帰する。
 */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const ORIGIN = "https://elxea.com";
const PRODUCT = "/ja/products/tea-ats-g-01";

// .env.local から読む (値は出力しない)
const env = readFileSync(new URL("./.env.prod-measure", `file://${process.env.WT}/`), "utf8");
const SITE_PASSWORD = env
  .match(/^SITE_PASSWORD=(.*)$/m)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, "");
if (!SITE_PASSWORD) throw new Error("SITE_PASSWORD not found");

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

// サイトのパスワードゲートを通す (cookie を 1 個もらうだけ)
const res = await ctx.request.post(`${ORIGIN}/api/site-auth`, {
  data: { password: SITE_PASSWORD },
});
if (!res.ok()) throw new Error(`site-auth failed: ${res.status()}`);

await page.goto(`${ORIGIN}${PRODUCT}`, { waitUntil: "load" });
await page.waitForSelector("button:has-text('カートに追加')", { timeout: 20000 });

const result = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "カートに追加",
  );
  if (!btn) return { error: "no button" };

  const cartLink = document.querySelector('header a[href*="/cart"]');
  const badgeBefore = (cartLink?.textContent || "").trim();

  const events = [];
  let t0 = null;
  const mark = (n) => {
    if (t0 !== null && !events.some((e) => e.name === n)) {
      events.push({ name: n, ms: Math.round(performance.now() - t0) });
    }
  };

  const check = () => {
    if (t0 === null) return;
    const spinning = !!btn.querySelector("svg.animate-spin");
    if (spinning) mark("spinner_visible");
    if (btn.getAttribute("aria-busy") === "true") mark("aria_busy");
    if ((btn.textContent || "").includes("追加しています")) mark("label_progress");
    if ((cartLink?.textContent || "").trim() !== badgeBefore) mark("badge_changed");
    if (document.querySelector("[data-sonner-toast]")) mark("toast_visible");
    if (events.some((e) => e.name === "spinner_visible") && !spinning) {
      mark("server_settled");
    }
  };

  const mo = new MutationObserver(check);
  mo.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const timer = setInterval(check, 5);

  t0 = performance.now();
  btn.click();

  await new Promise((r) => setTimeout(r, 20000));
  clearInterval(timer);
  mo.disconnect();

  return {
    badgeBefore,
    badgeAfter: (cartLink?.textContent || "").trim(),
    events: events.sort((a, b) => a.ms - b.ms),
  };
});

console.log(JSON.stringify(result, null, 2));

// --- 原状復帰: 入れたものをカートから外す ---
await page.goto(`${ORIGIN}/ja/cart`, { waitUntil: "load" });
const removed = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    (b.textContent || "").trim().includes("削除"),
  );
  if (!btn) return "no remove button (cart already empty?)";
  btn.click();
  await new Promise((r) => setTimeout(r, 8000));
  return "clicked remove";
});
await page.goto(`${ORIGIN}/ja/cart`, { waitUntil: "load" });
const cartState = await page.evaluate(() => document.body.innerText.slice(0, 200));
console.log(JSON.stringify({ cleanup: removed, cartAfter: cartState }, null, 2));

await browser.close();
