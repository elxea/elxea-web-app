// S2-5 fidelity 実測ハーネス。
// s2-4-fidelity.md の未解消差分 A (項目13/14) と C (項目16/17) の解消確認。
// 対象: 共通 Toolbar を使う 4 画面 (journal / 商品一覧 / お茶メニュー / 農家一覧)。
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:3187";
const paths = ["/ja/journal", "/ja/products", "/ja/tea-menu", "/ja/farmers"];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const out = [];

for (const p of paths) {
  await page.goto(base + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  out.push(
    await page.evaluate((path) => {
      const q = (s) => document.querySelector(s);
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: +r.left.toFixed(2),
          right: +r.right.toFixed(2),
          w: +r.width.toFixed(2),
          h: +r.height.toFixed(2),
        };
      };
      const chip = q('[data-slot="catalog-chip"]');
      const cs = chip ? getComputedStyle(chip) : null;
      return {
        path,
        toolbar: box(q('[data-slot="catalog-toolbar"]')),
        // 項目13 の溝はこの要素の w-full
        scrollerBox: box(q('[data-slot="catalog-chip-scroller"]')),
        // 項目14 の「チップ列の右端」
        chipsBox: box(q('[data-slot="catalog-chips"]')),
        fade: box(q('[data-slot="catalog-chips-fade"]')),
        groove: box(q('[data-slot="catalog-chips-scrollbar"]')),
        thumb: box(q('[data-slot="catalog-chips-scrollbar-thumb"]')),
        selectWrapper: {
          display: q('[data-slot="native-select-wrapper"]')
            ? getComputedStyle(q('[data-slot="native-select-wrapper"]')).display
            : "absent",
          box: box(q('[data-slot="native-select-wrapper"]')),
        },
        chip: chip
          ? {
              h: +chip.getBoundingClientRect().height.toFixed(2),
              padX: cs.paddingLeft,
              padY: cs.paddingTop,
              radius: cs.borderRadius,
            }
          : null,
        chipCount: document.querySelectorAll('[data-slot="catalog-chip"]').length,
      };
    }, p)
  );
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
