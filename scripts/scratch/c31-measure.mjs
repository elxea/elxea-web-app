// C3-1 忠実度実測ハーネス — 商品一覧 / お茶メニュー (Figma R2 共通リストパターン)
// 実画面の getComputedStyle / getBoundingClientRect を測る。目視ではなく数値で照合する。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = process.env.C31_OUT ?? "/tmp/c31-measure.json";
const SHOT = "/tmp/c31-shots";
fs.mkdirSync(SHOT, { recursive: true });

const probe = () => {
  const px = (v) => (v == null ? null : Math.round(parseFloat(v) * 100) / 100);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const box = (el) => (el ? el.getBoundingClientRect() : null);
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
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
        c.lineHeight === "normal" ? "normal"
          : Math.round((parseFloat(c.lineHeight) / parseFloat(c.fontSize)) * 1000) / 1000,
      letterSpacingEm:
        c.letterSpacing === "normal" ? 0
          : Math.round((parseFloat(c.letterSpacing) / parseFloat(c.fontSize)) * 10000) / 10000,
      letterSpacingPx: c.letterSpacing === "normal" ? 0 : px(c.letterSpacing),
      color: c.color,
      fontFamily: c.fontFamily.split(",")[0].replace(/["']/g, ""),
    };
  };
  const rect = (el) => {
    const B = box(el);
    if (!B) return null;
    return { x: px(B.x), y: px(B.y), w: px(B.width), h: px(B.height) };
  };

  const section = q('[data-slot="section"]');
  const head = q('[data-slot="list-page-head"]');
  const toolbar = q('[data-slot="catalog-toolbar"]');
  const chips = qa('[data-slot="catalog-chip"]');
  const sort = q('[data-slot="catalog-sort"]');
  const grid = q('[data-slot="catalog-grid"]');
  const cards = qa('[data-slot="catalog-card"]');
  const kind = q('[data-slot="kind-index"]');
  const more = q('[data-slot="more-row"]');
  const gcs = cs(grid);

  const card0 = cards[0] ?? null;
  const cardImg = card0 ? card0.children[0] : null;
  const cardInfo = card0 ? card0.children[1] : null;
  const cardOverline = cardInfo ? cardInfo.querySelector("p") : null;
  const cardTitle = cardInfo ? cardInfo.querySelector("h2") : null;
  const cardMeta = cardInfo ? cardInfo.querySelector("div") : null;

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    container: section
      ? {
          ...rect(section),
          paddingLeft: px(cs(section).paddingLeft),
          paddingTop: px(cs(section).paddingTop),
          paddingBottom: px(cs(section).paddingBottom),
        }
      : null,
    head: head
      ? {
          ...rect(head),
          gap: px(cs(head).rowGap),
          overline: type(head.children[0]),
          h1: type(head.querySelector("h1")),
          lead: type(head.children[2]),
        }
      : null,
    toolbar: toolbar
      ? {
          ...rect(toolbar),
          gapFromHead: gap(head, toolbar),
          chipCount: chips.length,
          chip0: chips[0]
            ? {
                ...rect(chips[0]),
                paddingLeft: px(cs(chips[0]).paddingLeft),
                paddingTop: px(cs(chips[0]).paddingTop),
                borderRadius: px(cs(chips[0]).borderTopLeftRadius),
                bg: cs(chips[0]).backgroundColor,
                borderWidth: px(cs(chips[0]).borderTopWidth),
                type: type(chips[0]),
              }
            : null,
          chipGap: chips[1] ? px(box(chips[1]).x - box(chips[0]).right) : null,
          sort: sort ? { ...rect(sort), borderRadius: px(cs(sort).borderTopLeftRadius) } : null,
        }
      : null,
    grid: grid
      ? {
          ...rect(grid),
          gapFromToolbar: gap(toolbar, grid),
          columns: gcs.gridTemplateColumns.split(" ").length,
          columnWidths: gcs.gridTemplateColumns.split(" ").map((v) => px(v)),
          columnGap: px(gcs.columnGap),
          rowGap: px(gcs.rowGap),
          cardCount: cards.length,
        }
      : null,
    card: card0
      ? {
          ...rect(card0),
          gapImageToInfo: px(cs(card0).rowGap),
          image: cardImg
            ? { ...rect(cardImg), aspectRatio: cs(cardImg).aspectRatio, borderRadius: px(cs(cardImg).borderTopLeftRadius), bg: cs(cardImg).backgroundColor }
            : null,
          infoGap: cardInfo ? px(cs(cardInfo).rowGap) : null,
          textAlign: cardInfo ? cs(cardInfo).textAlign : null,
          overline: type(cardOverline),
          title: type(cardTitle),
          meta: type(cardMeta),
        }
      : null,
    kindIndex: kind
      ? { ...rect(kind), display: cs(kind).display, gapFromGrid: gap(grid, kind) }
      : { present: false },
    moreRow: more
      ? {
          ...rect(more),
          gapFromPrev: gap(kind && cs(kind).display !== "none" ? kind : grid, more),
          button: more.firstElementChild
            ? { ...rect(more.firstElementChild), borderRadius: px(cs(more.firstElementChild).borderTopLeftRadius), type: type(more.firstElementChild) }
            : null,
        }
      : { present: false },
    docScrollWidth: document.documentElement.scrollWidth,
  };
};

const PAGES = [["products", "/ja/products"], ["tea-menu", "/ja/tea-menu"]];
const VIEWPORTS = [["pc", 1440, 900], ["sp", 375, 812]];

const results = {};
const browser = await chromium.launch();
for (const [vpName, w, h] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: "ja-JP" });
  const page = await ctx.newPage();
  for (const [name, path] of PAGES) {
    const resp = await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    results[`${name}@${vpName}`] = { status: resp.status(), url: page.url(), ...(await page.evaluate(probe)) };
    await page.screenshot({ path: `${SHOT}/${name}-${vpName}.png`, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log("WROTE", OUT);
