// PC 1440 で Toolbar の並び替え Select が Figma どおり 180x44 で出ているかの回帰確認。
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:3187";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const out = [];

for (const p of ["/ja/journal", "/ja/products", "/ja/contact"]) {
  await page.goto(base + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  out.push(
    await page.evaluate((path) => {
      const wrapper = document.querySelector('[data-slot="native-select-wrapper"]');
      const select = document.querySelector('[data-slot="native-select"]');
      const chips = document.querySelector('[data-slot="catalog-chips"]');
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: +r.width.toFixed(2), h: +r.height.toFixed(2), right: +r.right.toFixed(2) };
      };
      return {
        path,
        wrapperDisplay: wrapper ? getComputedStyle(wrapper).display : "absent",
        wrapper: box(wrapper),
        select: box(select),
        chipsRight: chips ? +chips.getBoundingClientRect().right.toFixed(2) : null,
        chipPadding: (() => {
          const c = document.querySelector('[data-slot="catalog-chip"]');
          if (!c) return null;
          const cs = getComputedStyle(c);
          return `${cs.paddingTop}/${cs.paddingLeft} h=${c.getBoundingClientRect().height}`;
        })(),
      };
    }, p)
  );
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
