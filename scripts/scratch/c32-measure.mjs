// C3-2 忠実度実測ハーネス — 商品詳細 / 定期便LP (Figma R2)
// 実画面の getComputedStyle / getBoundingClientRect を測る。目視ではなく数値で照合する。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = process.env.C32_OUT ?? "/tmp/c32-measure.json";
const SHOT = "/tmp/c32-shots";
fs.mkdirSync(SHOT, { recursive: true });

const probe = () => {
  const px = (v) => (v == null ? null : Math.round(parseFloat(v) * 100) / 100);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const box = (el) => (el ? el.getBoundingClientRect() : null);
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const type = (el) => {
    const c = cs(el);
    if (!c) return null;
    return {
      fontSize: px(c.fontSize),
      fontWeight: c.fontWeight,
      lineHeight: px(c.lineHeight),
      letterSpacingEm:
        c.letterSpacing === "normal"
          ? 0
          : Math.round((parseFloat(c.letterSpacing) / parseFloat(c.fontSize)) * 10000) / 10000,
      color: c.color,
      fontFamily: c.fontFamily.split(",")[0].replace(/["']/g, ""),
    };
  };
  const rect = (el) => {
    const B = box(el);
    if (!B) return null;
    return { x: px(B.x), y: px(B.y), w: px(B.width), h: px(B.height) };
  };
  const gapY = (a, b) => {
    const A = box(a), B = box(b);
    if (!A || !B) return null;
    return Math.round((B.top - A.bottom) * 100) / 100;
  };

  const sections = qa('[data-slot="page-section"]');
  const head = q('[data-slot="section-head"]');
  const headOverline = head ? head.querySelector("p") : null;
  const headTitle = head ? head.querySelector("h2, h3") : null;
  const specBand = q('[data-slot="spec-band"]');
  const specItems = qa('[data-slot="spec-item"]');
  const triple = q('[data-slot="triple-column"]');
  const tripleItems = qa('[data-slot="triple-item"]');
  const ledger = q('[data-slot="ledger"]');
  const ledgerRows = qa('[data-slot="ledger-row"]');
  const faq = q('[data-slot="open-faq"]');
  const faqRows = qa('[data-slot="open-faq-row"]');
  const purchase = q('[data-slot="purchase-column"]');
  const gallery = purchase ? purchase.parentElement.firstElementChild : null;
  const plot = q('[data-slot="taste-map-plot"]');
  const range = q('[data-slot="taste-map-range"]');
  const stepCards = qa('[data-slot="step-card"]');
  const ribbon = q('[data-slot="date-ribbon"]');
  const chip = q('[data-slot="month-chip"]');

  const gridOf = (el) => {
    const c = cs(el);
    if (!c) return null;
    return {
      columns: c.gridTemplateColumns.split(" ").map((v) => px(v)),
      columnGap: px(c.columnGap),
      rowGap: px(c.rowGap),
    };
  };

  const padOf = (el) => {
    const c = cs(el);
    if (!c) return null;
    return { top: px(c.paddingTop), bottom: px(c.paddingBottom), left: px(c.paddingLeft) };
  };

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    section: sections[0]
      ? { rect: rect(sections[0]), padding: padOf(sections[0]) }
      : null,
    head: head
      ? {
          overline: type(headOverline),
          title: type(headTitle),
          gap: gapY(headOverline, headTitle),
        }
      : null,
    specBand: specBand
      ? {
          rect: rect(specBand),
          grid: gridOf(specBand),
          paddingTop: padOf(specBand).top,
          borderTop: px(cs(specBand).borderTopWidth),
          itemCount: specItems.length,
          term: specItems[0] ? type(specItems[0].querySelector("dt")) : null,
          value: specItems[0] ? type(specItems[0].querySelector("dd")) : null,
          termToValue: specItems[0]
            ? gapY(specItems[0].querySelector("dt"), specItems[0].querySelector("dd"))
            : null,
        }
      : null,
    triple: triple
      ? {
          grid: gridOf(triple),
          itemW: tripleItems[0] ? rect(tripleItems[0]).w : null,
          title: tripleItems[0] ? type(tripleItems[0].querySelector("p")) : null,
          body: tripleItems[0] ? type(tripleItems[0].querySelectorAll("p")[1]) : null,
          paddingTop: tripleItems[0] ? padOf(tripleItems[0]).top : null,
        }
      : null,
    ledger: ledger
      ? {
          grid: gridOf(ledger),
          rowH: ledgerRows[0] ? rect(ledgerRows[0]).h : null,
          termW: ledgerRows[0] ? rect(ledgerRows[0].querySelector("dt")).w : null,
          termToValue: ledgerRows[0]
            ? Math.round(
                (box(ledgerRows[0].querySelector("dd")).left -
                  box(ledgerRows[0].querySelector("dt")).right) * 100
              ) / 100
            : null,
          term: ledgerRows[0] ? type(ledgerRows[0].querySelector("dt")) : null,
          value: ledgerRows[0] ? type(ledgerRows[0].querySelector("dd")) : null,
          rowCount: ledgerRows.length,
        }
      : null,
    faq: faq
      ? {
          rowCount: faqRows.length,
          rowH: faqRows[0] ? rect(faqRows[0]).h : null,
          padding: faqRows[0] ? padOf(faqRows[0]) : null,
          q: faqRows[0] ? type(faqRows[0].querySelector("dt")) : null,
          a: faqRows[0] ? type(faqRows[0].querySelector("dd")) : null,
          answerMaxW: faqRows[0] ? rect(faqRows[0].querySelector("dd")).w : null,
        }
      : null,
    topView: purchase
      ? {
          galleryW: gallery ? rect(gallery).w : null,
          purchaseW: rect(purchase).w,
          gap:
            gallery && rect(gallery).w
              ? Math.round((box(purchase).left - box(gallery).right) * 100) / 100
              : null,
          position: cs(purchase).position,
          title: type(q("h1")),
        }
      : null,
    tasteMap: plot
      ? {
          plot: rect(plot),
          aspect: rect(plot).w && rect(plot).h ? Math.round((rect(plot).w / rect(plot).h) * 100) / 100 : null,
          rangePct: range
            ? {
                left: Math.round(((box(range).left - box(plot).left) / rect(plot).w) * 10000) / 100,
                top: Math.round(((box(range).top - box(plot).top) / rect(plot).h) * 10000) / 100,
                w: Math.round((rect(range).w / rect(plot).w) * 10000) / 100,
                h: Math.round((rect(range).h / rect(plot).h) * 10000) / 100,
              }
            : null,
          pointCount: qa('[data-slot="taste-map-point"]').length,
        }
      : null,
    steps: stepCards.length
      ? { count: stepCards.length, rect: rect(stepCards[0]), padding: padOf(stepCards[0]) }
      : null,
    ribbon: ribbon ? { rect: rect(ribbon), type: type(ribbon) } : null,
    chip: chip ? { rect: rect(chip) } : null,
    ctaCount: qa('button, a[href="#plan"]').filter((el) =>
      /申し込|カートに入れる|定期便の中身/.test(el.textContent ?? "")
    ).length,
  };
};

const PAGES = [
  { id: "pdp", path: process.env.C32_PDP_PATH ?? "/ja/products/test-product" },
  { id: "lp", path: "/ja/subscription" },
];

const VIEWPORTS = [
  { id: "pc", width: 1440, height: 1200 },
  { id: "sp", width: 375, height: 900 },
];

const browser = await chromium.launch();
const out = {};

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  for (const p of PAGES) {
    const url = `${BASE}${p.path}`;
    const key = `${p.id}-${vp.id}`;
    try {
      const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(700);
      out[key] = { url, status: res?.status() ?? null, ...(await page.evaluate(probe)) };
      await page.screenshot({ path: `${SHOT}/${key}.png`, fullPage: true });
    } catch (e) {
      out[key] = { url, error: String(e).slice(0, 300) };
    }
  }
  await ctx.close();
}

await browser.close();
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log("written", OUT);
console.log(JSON.stringify(out, null, 2));
