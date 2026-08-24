/**
 * FIDELITY_GATE evidence for the content max-width 1280px -> 1312px switch.
 *
 * Setaka decision (2026/08/08): at a 1440px viewport the outer margin is the
 * authority and must be 64px on both sides, so the content column caps at
 * 1440 - 64*2 = 1312px.
 *
 * Measures real getComputedStyle / getBoundingClientRect values off the running
 * dev server. Run: node scripts/scratch/measure-content-width-1312.mjs
 * (scripts/scratch/ is gitignored — evidence tooling, not product code.)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TARGETS = ["/ja", "/en", "/ja/journal", "/ja/products"];
const VIEWPORTS = [
  { label: "SP", w: 390, expectMargin: 16 },
  { label: "TB", w: 834, expectMargin: 32 },
  { label: "PC", w: 1440, expectMargin: 64 },
  { label: "XL", w: 1728, expectMargin: 64 },
];

const browser = await chromium.launch();
const rows = [];

for (const path of TARGETS) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.w, height: 900 },
    });
    await page.goto(BASE + path, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2000);
    const m = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const el = document.querySelector(".page-container");
      if (!el) return { found: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const padL = parseFloat(cs.paddingLeft);
      const padR = parseFloat(cs.paddingRight);
      return {
        found: true,
        containerXlVar: root.getPropertyValue("--layout-container-xl").trim(),
        pageMarginVar: root.getPropertyValue("--page-margin").trim(),
        // outer margin = distance from viewport edge to the content column edge
        outerMarginLeft: Math.round(r.left + padL),
        outerMarginRight: Math.round(
          window.innerWidth - (r.right - padR),
        ),
        contentWidth: Math.round(r.width - padL - padR),
        elementWidth: Math.round(r.width),
        maxWidthComputed: cs.maxWidth,
      };
    });
    rows.push({ path, viewport: `${vp.label} ${vp.w}`, expectMargin: vp.expectMargin, ...m });
    await page.close();
  }
}
await browser.close();

// ---- table ----
const hdr = [
  "path", "viewport", "--layout-container-xl", "--page-margin",
  "outer margin L", "outer margin R", "content width", "expected margin", "verdict",
];
const body = rows.map((r) => {
  const vw = Number(r.viewport.split(" ")[1]);
  // Content caps at 1312 and centers; the outer margin is therefore the token
  // margin until the cap binds, and grows symmetrically beyond it.
  const expectedContent = Math.min(1312, vw - r.expectMargin * 2);
  const expectedMargin = Math.max(r.expectMargin, (vw - expectedContent) / 2);
  const okMargin =
    r.outerMarginLeft === expectedMargin && r.outerMarginRight === expectedMargin;
  const okContent = r.contentWidth === expectedContent;
  r.expectMargin = expectedMargin;
  return [
    r.path, r.viewport, r.containerXlVar, r.pageMarginVar,
    `${r.outerMarginLeft}px`, `${r.outerMarginRight}px`, `${r.contentWidth}px`,
    `${r.expectMargin}px`, okMargin && okContent ? "[OK]" : "[FAIL]",
  ];
});
const widths = hdr.map((h, i) =>
  Math.max(h.length, ...body.map((row) => String(row[i]).length)),
);
const line = (cells) =>
  "| " + cells.map((c, i) => String(c).padEnd(widths[i])).join(" | ") + " |";
console.log(line(hdr));
console.log("|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|");
body.forEach((row) => console.log(line(row)));
const fails = body.filter((r) => r[8] === "[FAIL]").length;
console.log(`\n${body.length - fails}/${body.length} rows OK, ${fails} FAIL`);
