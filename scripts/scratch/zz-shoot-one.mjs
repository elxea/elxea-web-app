import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/sw-probe";
const NAME = process.argv[2] ?? "probe";
const QUERY = process.argv[3] ?? "month=8&timeOfDay=night";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
await page.goto(`${BASE}/dev/seasonal-wash?${QUERY}`, {
  waitUntil: "networkidle",
});
await page
  .addStyleTag({ content: "nextjs-portal{display:none!important}" })
  .catch(() => {});
await page.waitForTimeout(6000);
const target = join(OUT, NAME + ".png");
await page.screenshot({ path: target });
console.log("saved", target);
await browser.close();
