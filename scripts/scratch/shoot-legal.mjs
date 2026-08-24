import { chromium } from "playwright";
import { createHmac } from "crypto";
import { readFileSync } from "fs";

// Replicate Next.js production env precedence for SITE_PASSWORD
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
if (!pw) {
  console.error("SITE_PASSWORD not found");
  process.exit(2);
}
const token = createHmac("sha256", pw).update(pw).digest("hex");

const OUT = process.argv[2] || "/tmp";
const BASE = "http://localhost:3128";
const pages = [
  ["tokushoho", "/ja/legal/tokushoho"],
  ["returns", "/ja/legal/returns"],
  ["privacy", "/ja/legal/privacy"],
];
const viewports = [
  ["pc", 1440, 900],
  ["sp", 390, 844],
];

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([
  {
    name: "site_auth",
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  },
]);

for (const [name, path] of pages) {
  for (const [vp, w, h] of viewports) {
    const page = await context.newPage();
    await page.setViewportSize({ width: w, height: h });
    const resp = await page.goto(BASE + path, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const status = resp ? resp.status() : "?";
    const finalUrl = page.url();
    await page.waitForTimeout(2500);
    const file = `${OUT}/legal-${name}-${vp}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${name} ${vp}: http ${status} url=${finalUrl} -> ${file}`);
    await page.close();
  }
}
await browser.close();
