import { chromium } from "playwright";

const OUT = process.argv[2] || "/tmp";
const PORT = process.argv[3] || "3200";
const BASE = `http://localhost:${PORT}`;
const pages = [
  ["tokushoho", "/ja/legal/tokushoho"],
  ["terms", "/ja/legal/terms"],
  ["subscription", "/ja/subscription"],
];

const browser = await chromium.launch();
const context = await browser.newContext();

for (const [name, path] of pages) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const resp = await page.goto(BASE + path, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const status = resp ? resp.status() : "?";
  await page.waitForTimeout(2500);
  const file = `${OUT}/gatevalues-${name}-pc1440.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`${name}: http ${status} url=${page.url()} -> ${file}`);
  await page.close();
}
await browser.close();
