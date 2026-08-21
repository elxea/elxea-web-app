import { chromium } from "playwright";
import { createHmac } from "crypto";
import { readFileSync } from "fs";

const files = [".env.production.local", ".env.local", ".env.production", ".env"];
let pw = process.env.SITE_PASSWORD;
for (const f of files) {
  if (pw) break;
  try {
    const txt = readFileSync(f, "utf8");
    const m = txt.match(/^\s*SITE_PASSWORD\s*=\s*(.*)\s*$/m);
    if (m) pw = m[1].replace(/^["']|["']$/g, "").trim();
  } catch {}
}
const token = pw ? createHmac("sha256", pw).update(pw).digest("hex") : null;

const OUT = process.argv[2] || "/tmp";
const PORT = process.argv[3] || "3200";
const BASE = `http://localhost:${PORT}`;
const pages = [
  ["events", "/ja/events"],
  ["farmers", "/ja/farmers"],
];

const browser = await chromium.launch();
const context = await browser.newContext();
if (token) {
  await context.addCookies([
    { name: "site_auth", value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
}

for (const [name, path] of pages) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const resp = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60000 });
  const status = resp ? resp.status() : "?";
  await page.waitForTimeout(3000);
  const imgCount = await page.locator("img").count();
  const file = `${OUT}/preview-seed-finish-${name}-pc1440.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`${name}: http ${status} url=${page.url()} imgs=${imgCount} -> ${file}`);
  await page.close();
}
await browser.close();
