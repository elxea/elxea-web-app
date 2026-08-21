/**
 * 本番 (elxea.com) の「季節のにじみ」背景を実測確認する。
 *
 * - サイトパスワードは Vercel production env から読むだけで、一切出力しない。
 *   cookie は middleware.ts の hashSitePasswordEdge と同じ HMAC-SHA256(key=pw, data=pw) hex。
 * - 読みもの系に背景が出ていること / 除外面に出ていないこと / 旧 URL が 404 でないこと
 *   / コンソールエラーを、ページごとに機械判定する。
 */
import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ENV_FILE = process.argv[2];
const OUT_DIR = process.argv[3] || "/tmp/roji-prod-verify";
const LABEL = process.argv[4] || "post";
const BASE = "https://elxea.com";

// --- サイトパスワードを読む (出力しない) ---
const envText = fs.readFileSync(ENV_FILE, "utf8");
const m = envText.match(/^SITE_PASSWORD="?((?:[^"\n\\]|\\.)*)"?$/m);
if (!m) {
  console.error("FATAL: SITE_PASSWORD not found in env file");
  process.exit(1);
}
// Vercel の env pull は値を JS 文字列リテラル風にエスケープするので \n 等を戻す
const password = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
const authCookie = crypto.createHmac("sha256", password).update(password).digest("hex");

fs.mkdirSync(OUT_DIR, { recursive: true });

// path, 期待値 (背景あり/なし), スクショを撮るか
const PAGES = [
  { p: "/ja/journal", wash: true, shot: "reading-1-journal" },
  { p: "/ja/tea-menu", wash: true, shot: "reading-2-tea-menu" },
  { p: "/ja/about", wash: true, shot: null },
  { p: "/ja/farmers", wash: true, shot: null },
  { p: "/ja/playlists", wash: true, shot: null },
  { p: "/ja/elxea-journal", wash: true, shot: null },
  { p: "/ja/tasting-note", wash: true, shot: null },
  // 除外面: 背景が出てはいけない
  { p: "/ja/cart", wash: false, shot: "excluded-1-cart" },
  { p: "/ja/products", wash: false, shot: null },
  { p: "/ja/collections", wash: false, shot: null },
  { p: "/ja/account", wash: false, shot: null },
  { p: "/ja/subscription", wash: false, shot: null },
  { p: "/ja/faq", wash: false, shot: null },
  { p: "/ja/contact", wash: false, shot: null },
];

const results = [];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
await context.addCookies([
  { name: "site_auth", value: authCookie, domain: "elxea.com", path: "/", httpOnly: false, secure: true },
]);

for (const spec of PAGES) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => consoleErrors.push("PAGEERROR: " + String(err).slice(0, 300)));

  let status = null;
  let finalUrl = null;
  let washPresent = null;
  let canvasCount = null;
  let err = null;

  try {
    const resp = await page.goto(BASE + spec.p, { waitUntil: "domcontentloaded", timeout: 60000 });
    status = resp ? resp.status() : null;
    finalUrl = page.url();
    // 背景は client 側でマウントされるので少し待つ
    await page.waitForTimeout(3500);
    washPresent = (await page.locator('[data-testid="roji-reading-wash"]').count()) > 0;
    canvasCount = await page.locator('[data-testid="roji-reading-wash"] canvas').count();
    if (spec.shot) {
      const file = path.join(OUT_DIR, `${LABEL}-${spec.shot}.png`);
      await page.screenshot({ path: file, fullPage: false });
    }
  } catch (e) {
    err = String(e).slice(0, 300);
  }

  const gatedOut = finalUrl && finalUrl.includes("/password");
  const ok =
    !err &&
    status === 200 &&
    !gatedOut &&
    washPresent === spec.wash;

  results.push({
    path: spec.p,
    status,
    finalUrl,
    expectWash: spec.wash,
    washPresent,
    canvasCount,
    gatedOut,
    consoleErrors,
    err,
    ok,
  });
  await page.close();
}

await browser.close();

console.log("=".repeat(78));
console.log(`RESULTS (${LABEL})`);
console.log("=".repeat(78));
for (const r of results) {
  console.log(
    [
      r.ok ? "[OK]  " : "[FAIL]",
      r.path.padEnd(22),
      `http=${r.status}`,
      `wash=${r.washPresent}(expect ${r.expectWash})`,
      `canvas=${r.canvasCount}`,
      r.gatedOut ? "GATED" : "",
      r.err ? `ERR=${r.err}` : "",
      r.consoleErrors.length ? `consoleErrors=${r.consoleErrors.length}` : "",
    ].join(" ")
  );
  for (const ce of r.consoleErrors) console.log("        console: " + ce);
}
const failed = results.filter((r) => !r.ok);
console.log("-".repeat(78));
console.log(`SUMMARY: ${results.length - failed.length}/${results.length} ok`);
fs.writeFileSync(path.join(OUT_DIR, `${LABEL}-results.json`), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
