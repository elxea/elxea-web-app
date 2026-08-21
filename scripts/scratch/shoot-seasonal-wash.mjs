// 使い捨て: SeasonalWash プレビューの代表パターンを撮る。
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "/tmp/seasonal-wash";
mkdirSync(OUT, { recursive: true });

const shots = [
  ["01-aug-morning", "month=8&timeOfDay=morning"],
  ["02-aug-night", "month=8&timeOfDay=night"],
  ["03-oct-day", "month=10&timeOfDay=day"],
  ["04-dec-night", "month=12&timeOfDay=night"],
  ["05-apr-morning", "month=4&timeOfDay=morning"],
  ["06-sep-dusk-tempo2-grain", "month=9&timeOfDay=dusk&tempo=2&grain=1"],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
// Next の dev インジケータ (左下のバッジ) を映さない
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});

for (const [name, query] of shots) {
  await page.goto(`${BASE}/dev/seasonal-wash?${query}`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.waitForTimeout(6000); // 漂いが進んだ状態を撮る
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("saved", `${OUT}/${name}.png`);
}

await browser.close();
