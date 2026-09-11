/**
 * 整理後のカタログ階層が一目で分かるサイドバー全体のスクリーンショット。
 * グループ (01〜99 の root と 04 の下位 group) だけを開き、component 配下の
 * story までは開かない (構造が読める粒度で止める)。
 */
import { chromium } from "playwright";
import path from "node:path";

const BASE = "http://localhost:6006";
const OUT_DIR =
  "/private/tmp/claude-501/-Users-setaka-github-circl-agents-circl-boss/facc7afb-1797-47b3-9c8d-07549f6b0ba0/scratchpad";
const OUT = path.join(OUT_DIR, "storybook-sidebar-hierarchy.png");

const browser = await chromium.launch({ headless: true });
// 幅を狭くすると Storybook がモバイルレイアウトに切り替わり
// デスクトップのサイドバー (#storybook-sidebar-region) 自体が消える。
// 幅は広く取り、撮るときにサイドバー要素だけを切り出す。
const page = await browser.newPage({
  viewport: { width: 1400, height: 3200 },
  deviceScaleFactor: 2,
});

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector('[data-nodetype="root"]', {
  timeout: 60000,
  state: "attached",
});
await page.waitForTimeout(6000);

// root は既定で開いている。group (04 の下位) は既定で畳まれていて、
// **aria-expanded を持たない** ので開閉状態では引けない。id で 1 件ずつ押す。
const groupIds = await page.evaluate(() =>
  [...document.querySelectorAll('[data-nodetype="group"]')].map((e) =>
    e.getAttribute("data-item-id")
  )
);
for (const id of groupIds) {
  await page.locator(`[data-item-id="${id}"]`).first().click();
  await page.waitForTimeout(400);
}
// component 配下の story は畳んで、構造が読める粒度で止める。
for (let i = 0; i < 40; i++) {
  const target = page
    .locator('[data-nodetype="component"][aria-expanded="true"]')
    .first();
  if ((await target.count()) === 0) break;
  await target.click();
  await page.waitForTimeout(250);
}
await page.waitForTimeout(1200);

await page.locator("#storybook-sidebar-region").first().screenshot({ path: OUT });

const rows = await page.evaluate(() =>
  [...document.querySelectorAll("[data-nodetype]")].map(
    (el) =>
      `${el.getAttribute("data-nodetype")}\t${el.getAttribute("data-item-id") || ""}\t${el.innerText.trim().split("\n")[0]}`
  )
);
console.log(`saved: ${OUT}`);
console.log(`tree rows: ${rows.length}`);
console.log(rows.join("\n"));

await browser.close();
