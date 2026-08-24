import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/seasonal-wash-v1-fix";
mkdirSync(OUT, { recursive: true });

const shots = [
  ["01-aug-morning", "month=8&timeOfDay=morning"],
  ["02-aug-night", "month=8&timeOfDay=night"],
  ["03-oct-day", "month=10&timeOfDay=day"],
  ["04-dec-night", "month=12&timeOfDay=night"],
  ["06-sep-dusk-tempo2-grain", "month=9&timeOfDay=dusk&tempo=2"],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});

for (const [name, query] of shots) {
  await page.goto(`${BASE}/dev/seasonal-wash?${query}`, {
    waitUntil: "networkidle",
  });
  await page
    .addStyleTag({ content: "nextjs-portal{display:none!important}" })
    .catch(() => {});
  await page.waitForTimeout(6000);
  const target = join(OUT, name + ".png");
  await page.screenshot({ path: target });
  console.log("saved", target);
}

await browser.close();
