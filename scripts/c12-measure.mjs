// C12-1 People 詳細 / コレクション詳細 実画面 getComputedStyle 実測ハーネス
//
// 対比表の「実装値」を、実際にレンダリングされた DOM の computed 値 /
// bounding box から取る (クラス名やトークンの見かけの解決値ではなく実測)。
// 作法は scripts/c91-measure.mjs / scripts/c81-measure.mjs に合わせた。
//
// 色は **canvas のピクセル値**で読む。Chromium は getComputedStyle の色を
// lab() / oklch() のまま返すことがあり、文字列パースでは嘘の値になる
// (C6-1R レーンの実証済み知見)。canvas の fillStyle に食わせて 1px 塗り、
// getImageData で sRGB バイトを読めば必ず #rrggbb に落ちる。
//
// SP は **375** で測る (Figma の SP フレームが 375 なので x 座標が直接比較できる)。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4310";
const OUT = process.env.C12_OUT ?? "/tmp/c12-measure.json";
const SHOT = process.env.C12_SHOTS ?? "/tmp/c12-shots";
fs.mkdirSync(SHOT, { recursive: true });

const PEOPLE_PATH = process.env.C12_PEOPLE_PATH ?? "/ja/people/masayuki-kubo";
// bio / website を持つ author (紹介文の節まで実測するため)
const PEOPLE_BIO_PATH = process.env.C12_PEOPLE_BIO_PATH ?? "/ja/people/roji-editorial";
const COLLECTION_PATH =
  process.env.C12_COLLECTION_PATH ?? "/ja/collections/assorted-tea-set";

/* -------------------------------------------------------------------------- */
/* 共通ヘルパ (ページ内で eval される文字列にするため関数を文字列化して注入)   */
/* -------------------------------------------------------------------------- */

const HELPERS = `
  const px = (v) => (v == null || v === "" ? null : Math.round(parseFloat(v) * 100) / 100);
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const box = (el) => (el ? el.getBoundingClientRect() : null);
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => [...root.querySelectorAll(s)];

  // --- canvas でピクセル値を読む (lab()/oklch() 対策) ---
  const _cv = document.createElement("canvas");
  _cv.width = 1; _cv.height = 1;
  const _ctx = _cv.getContext("2d", { willReadFrequently: true });
  const hex = (color) => {
    if (!color) return null;
    if (color === "transparent" || color === "rgba(0, 0, 0, 0)") return "transparent";
    _ctx.clearRect(0, 0, 1, 1);
    _ctx.fillStyle = "#000000";
    _ctx.fillStyle = color;
    _ctx.fillRect(0, 0, 1, 1);
    const d = _ctx.getImageData(0, 0, 1, 1).data;
    const h = "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    return d[3] === 255 ? h : h + "@a" + (d[3] / 255).toFixed(2);
  };

  /** ページ全体からの絶対 y (scrollY 込み)。Figma の y と比較するため */
  const absY = (el) => {
    const B = box(el);
    return B ? r2(B.top + window.scrollY) : null;
  };

  const boxOf = (el) => {
    const B = box(el);
    if (!B) return null;
    return { w: r2(B.width), h: r2(B.height), x: r2(B.left), y: r2(B.top + window.scrollY) };
  };

  /** 2 要素の縦の隙間 (上の下端 → 下の上端) */
  const gapY = (a, b) => {
    const A = box(a), B = box(b);
    if (!A || !B) return null;
    return r2(B.top - A.bottom);
  };

  const type = (el) => {
    const c = cs(el);
    if (!c) return null;
    return {
      ...boxOf(el),
      fontSize: px(c.fontSize),
      fontWeight: c.fontWeight,
      lineHeight: c.lineHeight === "normal" ? "normal" : px(c.lineHeight),
      letterSpacing: c.letterSpacing === "normal" ? "normal" : px(c.letterSpacing),
      color: hex(c.color),
      textTransform: c.textTransform,
      text: (el.textContent || "").trim().slice(0, 28),
    };
  };

  const surface = (el) => {
    const c = cs(el);
    if (!c) return null;
    return {
      ...boxOf(el),
      background: hex(c.backgroundColor),
      color: hex(c.color),
      borderTopWidth: px(c.borderTopWidth),
      borderTopColor: hex(c.borderTopColor),
      radius: px(c.borderTopLeftRadius),
      padding: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].map(px),
      display: c.display,
    };
  };

  /** グリッドの実列数と実測 gap (子の box から算出。トークン解決値ではない) */
  const gridFacts = (grid) => {
    if (!grid) return null;
    const kids = [...grid.children].map((k) => box(k));
    if (kids.length === 0) return null;
    const firstTop = Math.round(kids[0].top);
    const cols = kids.filter((k) => Math.round(k.top) === firstTop).length;
    const c = cs(grid);
    const rowTops = [...new Set(kids.map((k) => Math.round(k.top)))].sort((a, b) => a - b);
    return {
      cols,
      childW: r2(kids[0].width),
      childH: r2(kids[0].height),
      gapXMeasured: cols > 1 ? r2(kids[1].left - kids[0].right) : null,
      gapYMeasured:
        rowTops.length > 1 ? r2(rowTops[1] - (kids[0].top + kids[0].height)) : null,
      gapXComputed: px(c.columnGap),
      gapYComputed: px(c.rowGap),
      gridTemplateColumns: c.gridTemplateColumns,
      count: kids.length,
    };
  };

  /** 画像枠の縦横比 (実測 w/h)。Figma の 4:5 / 4:3 / 8:5 / 3:2 と突き合わせる */
  const ratio = (el) => {
    const B = box(el);
    if (!B || !B.height) return null;
    return { w: r2(B.width), h: r2(B.height), ar: r2(B.width / B.height) };
  };

  const overflow = () => ({
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  });

  const pageColors = () => {
    const b = cs(document.body);
    return { bodyBackground: hex(b.backgroundColor), bodyColor: hex(b.color) };
  };
`;

/* -------------------------------------------------------------------------- */
/* People 詳細                                                                 */
/* -------------------------------------------------------------------------- */

const peopleProbe = `(() => {
${HELPERS}
  const head = q('[data-slot="farmer-head"]');
  const crumbNav = q('nav[aria-label="Breadcrumb"]');
  const headText = q('[data-slot="farmer-head-text"]');
  const heroImg = head ? q('div[style*="aspect-ratio"]', head) : null;
  const kicker = headText ? qa("p", headText)[0] : null;
  const h1 = q("h1");
  const role = q('[data-slot="farmer-head-role"]');
  const stats = q('[data-slot="farmer-stats"]');
  const statVals = stats ? qa("dd", stats) : [];
  const statLabels = stats ? qa("dt", stats) : [];

  const quote = q('[data-slot="farmer-quote"]');
  const quoteText = quote ? q("blockquote", quote) : null;

  const sections = qa('[data-slot="farmer-section"]');
  const heads = qa('[data-slot="farmer-section-head"]');
  const bodies = qa('[data-slot="farmer-section-body"]');

  const processGrid = q('[data-slot="process-grid"]');
  const processItems = qa('[data-slot="process-item"]');
  const p0 = processItems[0] ?? null;
  const p0img = p0 ? q('div[style*="aspect-ratio"]', p0) : null;

  const interview = q('[data-slot="interview-list"]');
  const interviewRows = qa('[data-slot="interview-row"]');

  const band = q('[data-slot="farmer-data-band"]');
  const specBand = band ? q('[data-slot="spec-band"]', band) : null;

  const cardGrids = qa('[data-slot="farmer-card-grid"]');
  const journalGrid = q('[data-slot="journal-grid"]');
  // 記事の節は CatalogGrid (PC 3 列 / SP 2 列) を使う (商品詳細の読みもの節と同じ)
  const articleGrid = q('[data-slot="catalog-grid"]');

  // 節の並びを名前つきで拾う (キッカーのテキストで識別)
  const sectionMap = sections.map((s) => {
    const h = q('[data-slot="farmer-section-head"]', s);
    const ov = h ? q("p", h) : null;
    return {
      kicker: ov ? (ov.textContent || "").trim() : null,
      title: (() => { const t = h ? q("h2", h) : null; return t ? (t.textContent || "").trim().slice(0, 24) : null; })(),
      ...boxOf(s),
    };
  });

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    ...overflow(),
    ...pageColors(),

    head: surface(head),
    pageMarginX: head ? r2(box(q('[data-slot="farmer-head-text"]') ? head : head).left) : null,
    crumb: crumbNav ? boxOf(crumbNav) : null,
    crumbRowH: crumbNav && crumbNav.parentElement ? r2(box(crumbNav.parentElement).height) : null,
    heroImage: ratio(heroImg),
    heroTextX: headText ? r2(box(headText).left) : null,
    heroTextW: headText ? r2(box(headText).width) : null,
    kicker: type(kicker),
    h1: type(h1),
    role: type(role),
    meta: (() => {
      const ps = headText ? qa("p", headText) : [];
      // kicker / role / meta の順。role は data-slot 付きなので meta は role の次の p
      return ps.length >= 3 ? type(ps[2]) : null;
    })(),
    statsBox: stats ? surface(stats) : null,
    statValues: statVals.map(type),
    statLabels: statLabels.map(type),
    gapKickerToH1: gapY(kicker, h1),
    gapH1ToRole: gapY(h1, role),

    quote: quote ? surface(quote) : null,
    quoteText: quoteText ? type(quoteText) : null,

    sectionCount: sections.length,
    sectionMap,
    sectionHeadCount: heads.length,
    gapHeadToBody: heads[0] && bodies[0] ? gapY(heads[0], bodies[0]) : null,

    processGrid: gridFacts(processGrid),
    processPhoto: ratio(p0img),

    interviewW: interview ? r2(box(interview).width) : null,
    interviewRowGap:
      interviewRows.length > 1 ? gapY(interviewRows[0], interviewRows[1]) : null,
    interviewRows: interviewRows.length,

    band: band ? surface(band) : null,
    specBand: specBand ? { ...surface(specBand), cols: (() => {
      const c = cs(specBand); return c ? c.gridTemplateColumns : null; })() } : null,

    cardGrids: cardGrids.map(gridFacts),
    cardPhoto: (() => {
      const g = cardGrids[0]; if (!g) return null;
      const c0 = g.children[0]; if (!c0) return null;
      return ratio(q('div[style*="aspect-ratio"]', c0));
    })(),
    journalGrid: gridFacts(journalGrid),
    articleGrid: gridFacts(articleGrid),
    articleCardPhoto: (() => {
      if (!articleGrid) return null;
      const c0 = articleGrid.children[0]; if (!c0) return null;
      return ratio(q('div[style*="aspect-ratio"]', c0));
    })(),

    docHeight: document.documentElement.scrollHeight,
  };
})()`;

/* -------------------------------------------------------------------------- */
/* コレクション詳細                                                            */
/* -------------------------------------------------------------------------- */

const collectionProbe = `(() => {
${HELPERS}
  const sec = q('[data-slot="section"]');
  const crumbNav = q('nav[aria-label="Breadcrumb"]');
  const head = q('[data-slot="list-page-head"]');
  const overline = head ? qa("p", head)[0] : null;
  const h1 = q("h1");
  const heads = head ? qa("p", head) : [];
  const lead = heads.length > 1 ? heads[heads.length - 1] : null;
  const toolbar = q('[data-slot="catalog-toolbar"]');
  const chips = qa('[data-slot="catalog-chip"]');
  const sort = q('[data-slot="catalog-sort"]');
  const grid = q('[data-slot="catalog-grid"]');
  const cards = qa('[data-slot="catalog-card"]');
  const card0 = cards[0] ?? null;
  const cardImg = card0 ? q('div[style*="aspect-ratio"]', card0) : null;
  const cardTitle = q('[data-slot="catalog-card-title"]');
  const kind = q('[data-slot="kind-index"]');
  const more = q('[data-slot="more-row"]');
  const morePill = more ? q("a", more) : null;

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    ...overflow(),
    ...pageColors(),

    section: surface(sec),
    pageMarginX: sec ? r2(box(sec).left) : null,
    contentW: sec ? r2(box(sec).width) : null,

    crumb: crumbNav ? boxOf(crumbNav) : null,
    head: head ? boxOf(head) : null,
    overline: type(overline),
    h1: type(h1),
    lead: lead && lead !== overline ? type(lead) : null,

    // Toolbar: chipless 呼び出しなので chips は 0 件・SP では枠ごと非表示 (display:none)
    toolbar: toolbar ? surface(toolbar) : null,
    toolbarDisplay: toolbar ? cs(toolbar).display : "ABSENT",
    chipCount: chips.length,
    sortSelect: sort ? surface(sort) : null,
    sortDisplay: sort ? cs(sort).display : "ABSENT",

    gapHeadToGrid: head && grid ? gapY(head, grid) : null,
    gapToolbarToGrid: toolbar && grid ? gapY(toolbar, grid) : null,

    grid: gridFacts(grid),
    cardPhoto: ratio(cardImg),
    cardTitle: type(cardTitle),
    cardCount: cards.length,

    kindIndex: kind ? "PRESENT" : "ABSENT",
    more: more ? boxOf(more) : null,
    morePill: morePill ? surface(morePill) : null,

    docHeight: document.documentElement.scrollHeight,
  };
})()`;

/* -------------------------------------------------------------------------- */
/* 実行                                                                        */
/* -------------------------------------------------------------------------- */

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
const results = {};
const consoleLog = [];

page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) {
    consoleLog.push({ page: page.url(), type: msg.type(), text: msg.text() });
  }
});
page.on("pageerror", (err) =>
  consoleLog.push({ page: page.url(), type: "pageerror", text: String(err) })
);
page.on("requestfailed", (req) =>
  consoleLog.push({
    page: page.url(),
    type: "requestfailed",
    text: `${req.url()} ${req.failure()?.errorText ?? ""}`,
  })
);

for (const [name, path, probe] of [
  ["people", PEOPLE_PATH, peopleProbe],
  ["peopleBio", PEOPLE_BIO_PATH, peopleProbe],
  ["collection", COLLECTION_PATH, collectionProbe],
]) {
  for (const [label, width, height] of [
    ["pc", 1440, 900],
    ["sp", 375, 812],
  ]) {
    await page.setViewportSize({ width, height });
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    results[`${name}_${label}_status`] = res?.status() ?? null;
    await page.waitForTimeout(800);
    results[`${name}_${label}`] = await page.evaluate(probe);
    await page.screenshot({ path: `${SHOT}/${name}-${label}.png`, fullPage: true });
  }
}

// 並び替えが URL に載るか (?sort=) — chipless Toolbar の Select は PC のみ
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}${COLLECTION_PATH}`, { waitUntil: "networkidle" });
await page.selectOption('[data-slot="catalog-sort"]', "priceAsc").catch(() => {});
await page.waitForTimeout(1500);
results.collection_sort = {
  url: page.url(),
  firstCardHref: await page
    .evaluate(() => document.querySelector('[data-slot="catalog-card"]')?.getAttribute("href") ?? null)
    .catch(() => null),
};

// ?show= で追加読み込みできるか (MoreRow)
await page.goto(`${BASE}${COLLECTION_PATH}`, { waitUntil: "networkidle" });
const moreHref = await page.evaluate(
  () => document.querySelector('[data-slot="more-row"] a')?.getAttribute("href") ?? null
);
results.collection_more = { moreHref };
if (moreHref) {
  await page.goto(`${BASE}${moreHref.startsWith("/") ? moreHref : "/" + moreHref}`, {
    waitUntil: "networkidle",
  });
  results.collection_more.afterCards = await page.evaluate(
    () => document.querySelectorAll('[data-slot="catalog-card"]').length
  );
  results.collection_more.afterUrl = page.url();
}

results.console = consoleLog;
await browser.close();

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
console.log("console errors/warnings/pageerrors:", consoleLog.length);
