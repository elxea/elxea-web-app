import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 1600 } });
await p.goto("http://localhost:6006/", { waitUntil: "load", timeout: 60000 });
await p.waitForTimeout(8000);
const dump = async (tag) => {
  const r = await p.evaluate(() =>
    [...document.querySelectorAll('[data-nodetype="group"]')].map(
      e => `${e.getAttribute("data-item-id")}|exp=${e.getAttribute("aria-expanded")}|vis=${!!e.offsetParent}`
    )
  );
  console.log(tag, JSON.stringify(r));
};
await dump("before");
const g = p.locator('[data-item-id="04-visualizations-flavor"]');
console.log("count", await g.count());
await g.first().click();
await p.waitForTimeout(1200);
await dump("after-click");
const kids = await p.evaluate(() => [...document.querySelectorAll('[data-parent-id="04-visualizations-flavor"]')].map(e=>e.getAttribute("data-item-id")));
console.log("children:", JSON.stringify(kids));
await b.close();
