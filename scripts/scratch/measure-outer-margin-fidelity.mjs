/**
 * FIDELITY_GATE evidence for the 外周余白 64px / 書体トークン / letterSpacing task.
 *
 * Measures real getComputedStyle values off the running dev server and prints a
 * table that can be compared against the Figma-confirmed Foundations values.
 *
 * Run: node scripts/scratch/measure-outer-margin-fidelity.mjs
 * (scripts/scratch/ is gitignored — this is evidence tooling, not product code.)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TARGETS = [
  { path: "/ja", lang: "ja" },
  { path: "/en", lang: "en" },
];
const VIEWPORTS = [
  { label: "SP", w: 390, h: 844 },
  { label: "TB", w: 834, h: 1112 },
  { label: "PC", w: 1440, h: 900 },
];

const browser = await chromium.launch();
const rows = [];

for (const t of TARGETS) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.w, height: vp.h },
    });
    await page.goto(BASE + t.path, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const cs = (el, p) => (el ? getComputedStyle(el)[p] : "(absent)");
      const first = (sel) => document.querySelector(sel);
      const header = first("header > div");
      const footer = first("footer .section-wide");
      const body = document.body;
      const left = (el) =>
        el ? Math.round(el.getBoundingClientRect().left) : null;
      return {
        lang: document.documentElement.lang,
        pageMarginVar: getComputedStyle(body)
          .getPropertyValue("--page-margin")
          .trim(),
        headerPadLeft: cs(header, "paddingLeft"),
        headerContentLeft:
          header && left(header) + parseFloat(cs(header, "paddingLeft")),
        headerContentWidth: header
          ? Math.round(header.clientWidth - 2 * parseFloat(cs(header, "paddingLeft")))
          : null,
        footerPadLeft: cs(footer, "paddingLeft"),
        footerContentLeft:
          footer && left(footer) + parseFloat(cs(footer, "paddingLeft")),
        footerContentWidth: footer
          ? Math.round(footer.clientWidth - 2 * parseFloat(cs(footer, "paddingLeft")))
          : null,
        bodyFontFamily: cs(body, "fontFamily"),
        bodyFontSize: cs(body, "fontSize"),
        bodyLineHeight: cs(body, "lineHeight"),
        bodyLetterSpacing: cs(body, "letterSpacing"),
        h1FontFamily: cs(first("h1"), "fontFamily"),
        h1LetterSpacing: cs(first("h1"), "letterSpacing"),
        h2LetterSpacing: cs(first("h2"), "letterSpacing"),
        h3LetterSpacing: cs(first("h3"), "letterSpacing"),
      };
    });
    rows.push({ url: t.path, viewport: `${vp.label} ${vp.w}px`, ...m });
    await page.close();
  }
}
await browser.close();
console.log(JSON.stringify(rows, null, 2));
