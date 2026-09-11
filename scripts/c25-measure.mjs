// C2.5 実画面 getComputedStyle 実測ハーネス (一時スクリプト)
// 対比表の「実装値」がトークン/Tailwind クラスの解決値であるのに対し、
// これは実際にレンダリングされた DOM の computed 値 / bounding box を測る。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = process.env.C25_OUT ?? "/tmp/c25-measure.json";
const SHOT = "/tmp/c25-shots";
fs.mkdirSync(SHOT, { recursive: true });

// ページ内で走る測定関数群。ブラウザ文脈で評価される。
const probe = () => {
  const px = (v) => (v == null ? null : Math.round(parseFloat(v) * 100) / 100);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const box = (el) => (el ? el.getBoundingClientRect() : null);
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => [...root.querySelectorAll(s)];

  // 2要素の縦方向の隙間 (下端 → 上端)
  const gap = (a, b) => {
    const A = box(a), B = box(b);
    if (!A || !B) return null;
    return Math.round((B.top - A.bottom) * 100) / 100;
  };

  const type = (el) => {
    const c = cs(el);
    if (!c) return null;
    return {
      fontSize: px(c.fontSize),
      fontWeight: c.fontWeight,
      lineHeight: px(c.lineHeight),
      lineHeightRatio:
        c.lineHeight === "normal"
          ? "normal"
          : Math.round((parseFloat(c.lineHeight) / parseFloat(c.fontSize)) * 1000) / 1000,
      letterSpacing:
        c.letterSpacing === "normal"
          ? 0
          : Math.round((parseFloat(c.letterSpacing) / parseFloat(c.fontSize)) * 10000) / 10000,
      letterSpacingPx: c.letterSpacing === "normal" ? 0 : px(c.letterSpacing),
      fontFamily: c.fontFamily.split(",")[0].replace(/["']/g, ""),
    };
  };

  const rect = (el) => {
    const B = box(el);
    if (!B) return null;
    return {
      x: Math.round(B.x * 100) / 100,
      w: Math.round(B.width * 100) / 100,
      h: Math.round(B.height * 100) / 100,
    };
  };

  const container = q(".page-container") ?? q(".page-container-narrow");
  const cc = cs(container);

  const overlines = qa('[data-slot="overline"]');
  const metaRows = qa('[data-slot="meta-row"]');
  const discRows = qa('[data-slot="disclosure-row"]');
  const linkRows = qa('[data-slot="link-row"]');
  const defRows = qa('[data-slot="definition-row"]');
  const pairRows = qa('[data-slot="pair-row"]');
  const stepRows = qa('[data-slot="step-row"]');
  const rateRows = qa('[data-slot="rate-row"]');
  const indexRows = qa('[data-slot="index-row"]');
  const catIndex = q('[data-slot="category-index"]');
  const chapter = q('[data-slot="chapter-break"]');
  const h1 = q("h1");
  const h3 = q("h3");
  const lead = h1 ? h1.nextElementSibling : null;
  const crumb = q("nav[aria-label], ol");

  const openRow = discRows.find((r) => r.tagName === "DETAILS" && r.open) ?? null;
  const closedRow = discRows.find((r) => r.tagName === "DETAILS" && !r.open) ?? null;

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    docHeight: document.documentElement.scrollHeight,
    container: container
      ? {
          paddingLeft: px(cc.paddingLeft),
          paddingRight: px(cc.paddingRight),
          width: rect(container).w,
          contentWidth:
            Math.round(
              (rect(container).w - parseFloat(cc.paddingLeft) - parseFloat(cc.paddingRight)) * 100
            ) / 100,
          maxWidth: cc.maxWidth,
        }
      : null,
    typography: {
      h1: type(h1),
      h3: type(h3),
      overline: type(overlines[0]),
      lead: type(lead),
      metaRowValue: metaRows[0] ? type(metaRows[0].querySelector("dd") ?? metaRows[0]) : null,
    },
    s1: {
      sectionPaddingTop: (() => {
        const s = crumb?.closest("section, div[class*='pt-']");
        return s ? px(cs(s).paddingTop) : null;
      })(),
      crumbToOverline: gap(crumb, overlines[0]),
      overlineToH1: gap(overlines[0], h1),
      h1ToLead: gap(h1, lead),
      leftCol: h1 ? rect(h1.parentElement) : null,
      rightCol: overlines[1] ? rect(overlines[1].parentElement) : null,
      metaLabelWidth: metaRows[0] ? rect(metaRows[0].querySelector("dt")) : null,
      metaRowHeight: metaRows[0] ? rect(metaRows[0]).h : null,
      metaRowCount: metaRows.length,
    },
    s2: catIndex
      ? {
          paddingTop: px(cs(catIndex).paddingTop),
          paddingBottom: px(cs(catIndex).paddingBottom),
          rect: rect(catIndex),
          itemCount: qa("li", catIndex).length,
          firstItemRect: rect(qa("li", catIndex)[0]),
          gridGap: px(cs(qa("ul,ol", catIndex)[0] ?? catIndex).columnGap),
        }
      : null,
    s3: {
      groupGap: (() => {
        const wrap = discRows[0]?.closest("section")?.parentElement;
        return wrap ? px(cs(wrap).rowGap) : null;
      })(),
      overlineToH3: overlines[2] ? gap(overlines[2], h3) : gap(overlines[0], h3),
      rowClosedHeight: closedRow ? rect(closedRow).h : null,
      rowOpenHeight: openRow ? rect(openRow).h : null,
      rowPaddingTop: closedRow ? px(cs(closedRow.querySelector("summary") ?? closedRow).paddingTop) : null,
      questionMaxWidth: (() => {
        const el = discRows[0]?.querySelector("summary *, p, span");
        return el ? cs(el).maxWidth : null;
      })(),
      rowCount: discRows.length,
    },
    s4: chapter
      ? {
          rect: rect(chapter),
          bg: cs(chapter).backgroundColor,
          color: cs(chapter).color,
          paddingTop: px(cs(chapter).paddingTop),
          paddingBottom: px(cs(chapter).paddingBottom),
        }
      : null,
    s5: linkRows[0]
      ? {
          rowHeight: rect(linkRows[0]).h,
          titleWidth: rect(linkRows[0].children[0]).w,
          rowCount: linkRows.length,
        }
      : null,
    rowSlots: {
      definitionRow: defRows[0] ? { h: rect(defRows[0]).h, count: defRows.length } : null,
      pairRow: pairRows[0] ? { h: rect(pairRows[0]).h, count: pairRows.length } : null,
      stepRow: stepRows[0] ? { h: rect(stepRows[0]).h, count: stepRows.length } : null,
      rateRow: rateRows[0] ? { h: rect(rateRows[0]).h, count: rateRows.length } : null,
      indexRow: indexRows[0] ? { h: rect(indexRows[0]).h, count: indexRows.length } : null,
    },
  };
};

const PAGES = [
  ["home", "/ja"],
  ["products", "/ja/products"],
  ["faq", "/ja/faq"],
  ["shipping", "/ja/shipping"],
  ["returns", "/ja/legal/returns"],
  ["terms", "/ja/legal/terms"],
  ["tokushoho", "/ja/legal/tokushoho"],
  ["journal", "/ja/journal"],
];
const VIEWPORTS = [
  ["pc", 1440, 900],
  ["sp", 375, 812],
];

const results = {};
const browser = await chromium.launch();
for (const [vpName, w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    locale: "ja-JP",
  });
  const page = await ctx.newPage();
  for (const [name, path] of PAGES) {
    const resp = await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    results[`${name}@${vpName}`] = {
      status: resp.status(),
      url: page.url(),
      ...(await page.evaluate(probe)),
    };
    await page.screenshot({ path: `${SHOT}/${name}-${vpName}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log("WROTE", OUT);
