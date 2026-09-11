// C9-1 農家一覧 / お茶メニュー詳細 実画面 getComputedStyle 実測ハーネス
//
// 対比表の「実装値」を、実際にレンダリングされた DOM の computed 値 /
// bounding box から取る (クラス名やトークンの見かけの解決値ではなく実測)。
// 作法は scripts/c25-measure.mjs / scripts/c71-measure.mjs に合わせた。
//
// 色は **canvas のピクセル値**で読む。Chromium は getComputedStyle の色を
// lab() / oklch() のまま返すことがあり、文字列パースでは嘘の値になる
// (C6-1R レーンの実証済み知見)。canvas の fillStyle に食わせて 1px 塗り、
// getImageData で sRGB バイトを読めば必ず #rrggbb に落ちる。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3972";
const OUT = process.env.C91_OUT ?? "/tmp/c91-measure.json";
const SHOT = "/tmp/c91-shots";
fs.mkdirSync(SHOT, { recursive: true });

const FARMERS_PATH = process.env.C91_FARMERS_PATH ?? "/ja/farmers";
const TEA_PATH = process.env.C91_TEA_PATH ?? "/ja/tea-menu/seed-tea-1";

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
    // 無効値のとき前の fillStyle が残らないよう既知値でリセットしてから代入する
    _ctx.fillStyle = "#000000";
    _ctx.fillStyle = color;
    _ctx.fillRect(0, 0, 1, 1);
    const d = _ctx.getImageData(0, 0, 1, 1).data;
    const h = "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    return d[3] === 255 ? h : h + "@a" + (d[3] / 255).toFixed(2);
  };

  /** 2 要素の縦の隙間 (上の下端 → 下の上端) */
  const gapY = (a, b) => {
    const A = box(a), B = box(b);
    if (!A || !B) return null;
    return r2(B.top - A.bottom);
  };
  /** 2 要素の横の隙間 (左の右端 → 右の左端) */
  const gapX = (a, b) => {
    const A = box(a), B = box(b);
    if (!A || !B) return null;
    return r2(B.left - A.right);
  };

  const boxOf = (el) => {
    const B = box(el);
    if (!B) return null;
    return { w: r2(B.width), h: r2(B.height), x: r2(B.left), y: r2(B.top) };
  };

  const type = (el) => {
    const c = cs(el);
    if (!c) return null;
    return {
      fontSize: px(c.fontSize),
      fontWeight: c.fontWeight,
      lineHeight: c.lineHeight === "normal" ? "normal" : px(c.lineHeight),
      letterSpacing: c.letterSpacing === "normal" ? "normal" : px(c.letterSpacing),
      color: hex(c.color),
      textTransform: c.textTransform,
      text: (el.textContent || "").trim().slice(0, 24),
    };
  };

  const surface = (el) => {
    const c = cs(el);
    if (!c) return null;
    return {
      ...boxOf(el),
      background: hex(c.backgroundColor),
      borderTopWidth: px(c.borderTopWidth),
      borderTopColor: hex(c.borderTopColor),
      borderBottomWidth: px(c.borderBottomWidth),
      radius: px(c.borderTopLeftRadius),
      padding: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].map(px),
      gapRow: c.rowGap === "normal" ? null : px(c.rowGap),
      gapCol: c.columnGap === "normal" ? null : px(c.columnGap),
      display: c.display,
      gridTemplateColumns: c.gridTemplateColumns,
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
        rowTops.length > 1
          ? r2(rowTops[1] - (kids[0].top + kids[0].height))
          : null,
      gapXComputed: px(c.columnGap),
      gapYComputed: px(c.rowGap),
      gridTemplateColumns: c.gridTemplateColumns,
      count: kids.length,
    };
  };

  const overflow = () => ({
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
  });

  const pageColors = () => {
    const b = cs(document.body);
    return {
      bodyBackground: hex(b.backgroundColor),
      bodyColor: hex(b.color),
    };
  };
`;

/* -------------------------------------------------------------------------- */
/* 農家一覧                                                                    */
/* -------------------------------------------------------------------------- */

const farmersProbe = `(() => {
${HELPERS}
  const sec = q('[data-slot="section"]');
  const crumbNav = q('nav[aria-label="Breadcrumb"]');
  const head = q('[data-slot="list-page-head"]');
  const overline = head ? q("p", head) : null;
  const h1 = q("h1");
  const leadEls = head ? qa("p", head) : [];
  const lead = leadEls.length > 1 ? leadEls[leadEls.length - 1] : null;
  const toolbar = q('[data-slot="catalog-toolbar"]');
  const chips = qa('[data-slot="catalog-chip"]');
  const grid = q('[data-slot="catalog-grid"]');
  const cards = qa('[data-slot="catalog-card"]');
  const card0 = cards[0] ?? null;
  const cardImg = card0 ? card0.firstElementChild : null;
  const cardInfo = card0 ? card0.lastElementChild : null;
  const cardOverline = card0 ? q("p", card0) : null;
  const cardTitle = q('[data-slot="catalog-card-title"]');
  const kind = q('[data-slot="kind-index"]');
  const more = q('[data-slot="more-row"]');
  const morePill = more ? q("a", more) : null;

  const imgBox = box(cardImg);

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    ...overflow(),
    ...pageColors(),
    section: surface(sec),
    // 外余白 = section の左端。content 幅 = section の幅
    pageMargin: imgBox ? r2(box(sec).left) : null,
    pt_sectionTop_to_crumb: gapY(sec, crumbNav) === null ? null : r2(box(crumbNav).top - box(sec).top),
    blockGaps: {
      crumb_to_head: gapY(crumbNav, head),
      head_to_toolbar: gapY(head, toolbar),
      toolbar_to_grid: gapY(toolbar, grid),
      grid_to_kind: gapY(grid, kind),
      kind_to_more: gapY(kind, more),
      grid_to_more: gapY(grid, more),
    },
    headInternal: {
      overline_to_h1: gapY(overline, h1),
      h1_to_lead: gapY(h1, lead),
      computedGap: surface(head)?.gapRow ?? null,
    },
    typography: {
      overline: type(overline),
      h1: type(h1),
      lead: type(lead),
      cardOverline: type(cardOverline),
      cardTitle: type(cardTitle),
      chip: type(chips[0] ?? null),
      morePill: type(morePill),
      kindLabel: type(kind ? q("p", kind) : null),
      kindLink: type(kind ? q("a", kind) : null),
    },
    chip: {
      count: chips.length,
      first: surface(chips[0] ?? null),
      second: surface(chips[1] ?? null),
      gapMeasured: chips.length > 1 ? gapX(chips[0], chips[1]) : null,
      activeBackground: chips[0] ? hex(cs(chips[0]).backgroundColor) : null,
      activeColor: chips[0] ? hex(cs(chips[0]).color) : null,
      inactiveBackground: chips[1] ? hex(cs(chips[1]).backgroundColor) : null,
      inactiveBorderColor: chips[1] ? hex(cs(chips[1]).borderTopColor) : null,
      inactiveBorderWidth: chips[1] ? px(cs(chips[1]).borderTopWidth) : null,
    },
    grid: gridFacts(grid),
    card: {
      count: cards.length,
      linkedCount: cards.filter((c) => c.tagName === "A").length,
      unlinkedCount: cards.filter((c) => c.getAttribute("data-linked") === "false").length,
      box: boxOf(card0),
      image: surface(cardImg),
      imageAspect: imgBox && imgBox.height ? r2(imgBox.width / imgBox.height) : null,
      image_to_info: gapY(cardImg, cardInfo),
      infoGapComputed: surface(cardInfo)?.gapRow ?? null,
      overline_to_title: gapY(cardOverline, cardTitle),
    },
    more: {
      row: surface(more),
      pill: surface(morePill),
    },
    kind: {
      present: Boolean(kind),
      display: kind ? cs(kind).display : null,
      box: boxOf(kind),
      cols: kind ? gridFacts(q("ul", kind)) : null,
      label_to_list: kind ? gapY(q("p", kind), q("ul", kind)) : null,
    },
  };
})()`;

/* -------------------------------------------------------------------------- */
/* お茶メニュー詳細                                                            */
/* -------------------------------------------------------------------------- */

const teaProbe = `(() => {
${HELPERS}
  const crumbWrap = q(".page-container");
  const crumbNav = q('nav[aria-label="Breadcrumb"]');
  const sections = qa('[data-slot="page-section"]');
  const hero = sections[0] ?? null;
  const heroGrid = hero ? hero.firstElementChild : null;
  const heroPhoto = heroGrid ? heroGrid.firstElementChild : null;
  const info = q('[data-slot="tea-hero-info"]');
  const infoPs = info ? [...info.children] : [];
  const overline = infoPs[0] ?? null;
  const h1 = q("h1");
  const no = info ? qa("p", info)[1] ?? null : null;
  const desc = info ? info.lastElementChild : null;

  const heads = qa('[data-slot="section-head"]');
  const titles = qa('[data-slot="section-title"]');
  const bodies = qa('[data-slot="section-body"]');
  const bands = qa('[data-slot="spec-band"]');
  const specBand = bands[0] ?? null;
  const brewBand = bands[1] ?? null;
  const specItems = specBand ? qa('[data-slot="spec-item"]', specBand) : [];
  const specDt = specItems[0] ? q("dt", specItems[0]) : null;
  const specDd = specItems[0] ? q("dd", specItems[0]) : null;

  // ヘッダーの共通ボタンを拾わないよう、購入 CTA は自前の枠の内側に限定する
  const buyWrap = q('[data-slot="tea-buy"]');
  const btn = buyWrap ? q('[data-slot="button"]', buyWrap) : null;
  const related = q('[data-slot="tea-related-article"]');
  const relatedLabel = related ? q("p", related) : null;
  const relatedRow = related ? q("a", related) : null;

  const photoBox = box(heroPhoto);

  // 節と節の実測間隔 (PageSection の py が両側に効く)
  const sectionGaps = [];
  for (let i = 1; i < sections.length; i++) {
    sectionGaps.push(gapY(sections[i - 1], sections[i]));
  }

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    ...overflow(),
    ...pageColors(),
    sectionCount: sections.length,
    pageMargin: crumbWrap ? r2(box(crumbWrap).left) : null,
    contentWidth: crumbWrap ? r2(box(crumbWrap).width) : null,
    pt_top_to_crumb: crumbWrap && crumbNav ? r2(box(crumbNav).top - box(crumbWrap).top) : null,
    crumb_to_hero: gapY(crumbNav, hero),
    sectionPadding: surface(hero)?.padding ?? null,
    sectionGapsMeasured: sectionGaps,
    hero: {
      grid: surface(heroGrid),
      gridGapX: surface(heroGrid)?.gapCol ?? null,
      photo: surface(heroPhoto),
      photoAspect: photoBox && photoBox.height ? r2(photoBox.width / photoBox.height) : null,
      photo_to_info: gapY(heroPhoto, info),
      infoTopAligned:
        photoBox && box(info) ? Math.abs(box(info).top - photoBox.top) < 2 : null,
      infoGaps: {
        overline_to_h1: gapY(overline, h1),
        h1_to_no: gapY(h1, no),
        no_to_desc: gapY(no, desc),
      },
    },
    sectionHead: {
      count: heads.length,
      overline_to_title: gapY(heads[0] ? q("p", heads[0]) : null, titles[0] ?? null),
      title_to_body: gapY(titles[0] ?? null, bodies[0] ?? null),
      overline: type(heads[0] ? q("p", heads[0]) : null),
      title: type(titles[0] ?? null),
    },
    specBand: {
      surface: surface(specBand),
      grid: gridFacts(specBand),
      itemCount: specItems.length,
      borderTopWidth: specBand ? px(cs(specBand).borderTopWidth) : null,
      borderTopColor: specBand ? hex(cs(specBand).borderTopColor) : null,
      border_to_row: specBand && specItems[0]
        ? r2(box(specItems[0]).top - box(specBand).top)
        : null,
      dt: type(specDt),
      dd: type(specDd),
      dt_to_dd: gapY(specDt, specDd),
      terms: specItems.map((it) => (q("dt", it)?.textContent || "").trim()),
      values: specItems.map((it) => (q("dd", it)?.textContent || "").trim()),
    },
    brewBand: {
      present: Boolean(brewBand),
      grid: gridFacts(brewBand),
      itemCount: brewBand ? qa('[data-slot="spec-item"]', brewBand).length : 0,
      terms: brewBand
        ? qa('[data-slot="spec-item"]', brewBand).map((it) => (q("dt", it)?.textContent || "").trim())
        : [],
      values: brewBand
        ? qa('[data-slot="spec-item"]', brewBand).map((it) => (q("dd", it)?.textContent || "").trim())
        : [],
    },
    buyButton: {
      present: Boolean(btn),
      surface: surface(btn),
      type: type(btn),
      fullWidth:
        btn && buyWrap ? Math.abs(box(btn).width - box(buyWrap).width) < 2 : null,
      wrapWidth: boxOf(buyWrap)?.w ?? null,
      buy_to_related: gapY(buyWrap, related),
    },
    related: {
      present: Boolean(related),
      label: type(relatedLabel),
      label_to_row: gapY(relatedLabel, relatedRow),
      row: surface(relatedRow),
      rowTitle: type(relatedRow ? q("span", relatedRow) : null),
    },
    // データが無い節を出していないことの確認 (見本は購入・関連記事を持たない)
    emptySectionCheck: {
      sectionSlots: sections.map((s) => {
        const head = q('[data-slot="section-head"]', s);
        return head ? (q("p", head)?.textContent || "").trim() : "(hero)";
      }),
    },
  };
})()`;

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

const results = { base: BASE, paths: { farmers: FARMERS_PATH, tea: TEA_PATH } };
const consoleLog = [];

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Tokyo" });
const page = await context.newPage();

page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) {
    consoleLog.push({ page: page.url(), type: msg.type(), text: msg.text() });
  }
});
page.on("pageerror", (err) =>
  consoleLog.push({ page: page.url(), type: "pageerror", text: String(err) }),
);
page.on("requestfailed", (req) =>
  consoleLog.push({
    page: page.url(),
    type: "requestfailed",
    text: `${req.url()} ${req.failure()?.errorText ?? ""}`,
  }),
);

for (const [name, path, probe] of [
  ["farmers", FARMERS_PATH, farmersProbe],
  ["tea", TEA_PATH, teaProbe],
]) {
  for (const [label, width, height] of [
    ["pc", 1440, 900],
    ["sp", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    results[`${name}_${label}_status`] = res?.status() ?? null;
    await page.waitForTimeout(700);
    results[`${name}_${label}`] = await page.evaluate(probe);
    await page.screenshot({ path: `${SHOT}/${name}-${label}.png`, fullPage: true });
  }
}

// 一覧 → 詳細の遷移 (実データの農家がいる場合のみリンクが張られる)
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}${FARMERS_PATH}`, { waitUntil: "networkidle" });
results.farmers_links = await page.evaluate(() => ({
  linked: [...document.querySelectorAll('a[data-slot="catalog-card"]')].map((a) =>
    a.getAttribute("href"),
  ),
  unlinked: document.querySelectorAll('[data-slot="catalog-card"][data-linked="false"]').length,
}));

// 産地フィルタが URL に載るか (?region=)
const firstChip = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('[data-slot="catalog-chip"]')];
  return chips.length > 1 ? chips[1].textContent?.trim() ?? null : null;
});
if (firstChip) {
  await page.click(`[data-slot="catalog-chip"]:nth-of-type(2)`).catch(() => {});
  await page.waitForTimeout(1200);
  results.farmers_filter = { clickedChip: firstChip, url: page.url() };
}

results.console = consoleLog;
await browser.close();

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
console.log("console errors/warnings/pageerrors:", consoleLog.length);
