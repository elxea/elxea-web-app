// 使い捨て: prefers-reduced-motion で本当に止まるか / 通常時は動くかを実測する。
import { chromium } from "playwright";
import { createHash } from "node:crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const URL = `${BASE}/dev/seasonal-wash?month=8&timeOfDay=day`;

const browser = await chromium.launch();

async function sample(reducedMotion) {
  const page = await browser.newPage({
    viewport: { width: 800, height: 500 },
    reducedMotion,
  });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.waitForTimeout(2500);
  const clip = { x: 0, y: 0, width: 800, height: 440 };
  const a = await page.screenshot({ clip });
  await page.waitForTimeout(5000);
  const b = await page.screenshot({ clip });
  await page.close();
  const h = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);
  return { first: h(a), second: h(b), identical: h(a) === h(b) };
}

console.log("reduce :", await sample("reduce"));
console.log("no-pref:", await sample("no-preference"));

await browser.close();
