// C11-1 About (R2 確定版 / C案・目次付き読み物型) 実画面 実測ハーネス
//
// 対比表の「実装値」を、実際にレンダリングされた DOM の computed 値 /
// bounding box から取る (クラス名やトークンの見かけの解決値ではなく実測)。
// 作法は scripts/c91-measure.mjs / scripts/c81-measure.mjs に合わせた。
//
// 色は **canvas のピクセル値**で読む。Chromium は getComputedStyle の色を
// lab() / oklch() のまま返すことがあり、文字列パースでは嘘の値になる
// (C6-1R レーンの実証済み知見)。canvas の fillStyle に食わせて 1px 塗り、
// getImageData で sRGB バイトを読めば必ず #rrggbb に落ちる。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3972";
const OUT = process.env.C11_OUT ?? "/tmp/c11-measure.json";
const SHOT = "/tmp/c11-shots";
fs.mkdirSync(SHOT, { recursive: true });

const ABOUT_PATH = process.env.C11_ABOUT_PATH ?? "/ja/about";

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
/* About probe                                                                 */
/* -------------------------------------------------------------------------- */

const aboutProbe = new Function(`
  ${HELPERS}

  const sections = qa('[data-slot="page-section"]');
  const sectionOf = (id) => q('section#' + id);
  const headOf = (root) => (root ? q('[data-slot="about-section-head"]', root) : null);

  const secFacts = (root) => {
    if (!root) return null;
    const c = cs(root);
    return {
      ...boxOf(root),
      paddingTop: px(c.paddingTop),
      paddingBottom: px(c.paddingBottom),
      paddingLeft: px(c.paddingLeft),
      scrollMarginTop: px(c.scrollMarginTop),
    };
  };

  const headFacts = (root) => {
    const h = headOf(root);
    if (!h) return null;
    const ov = q('[data-slot="overline"]', h);
    const title = q('[data-slot="section-title"]', h);
    return {
      overline: type(ov),
      overlineBox: boxOf(ov),
      title: type(title),
      titleBox: boxOf(title),
      overlineToTitle: gapY(ov, title),
      titleTag: title ? title.tagName.toLowerCase() : null,
    };
  };

  /* ---- header / breadcrumb ---- */
  const header = q("header");
  const crumb = q('nav[aria-label="Breadcrumb"]');

  /* ---- Statement ---- */
  const statement = q('[data-slot="about-statement"]');
  const stOverline = statement ? q('[data-slot="overline"]', statement) : null;
  const stTitle = q("h1.page-title");
  const stLead = statement ? qa("div", statement).find((d) => d.querySelector("p")) : null;
  const stLeadP = stLead ? qa("p", stLead) : [];

  /* ---- mokuji ---- */
  const index = q('[data-slot="category-index"]');
  const indexItems = index ? qa("li", index) : [];
  const indexLinks = index ? qa("a", index) : [];
  const indexUl = index ? q("ul", index) : null;

  /* ---- 01 ---- */
  const us = sectionOf("us");
  const usBody = us ? q('[data-slot="section-body"]', us) : null;
  const usBodyP = usBody ? qa("p", usBody) : [];
  const usFigure = q('[data-slot="about-us-figure"]');
  const usImage = usFigure ? usFigure.firstElementChild : null;

  /* ---- origins ---- */
  const origins = q('[data-slot="about-origins"]');
  const originsSection = origins ? origins.closest('[data-slot="page-section"]') : null;
  const originsOverline = originsSection ? q('[data-slot="overline"]', originsSection) : null;
  const originItems = origins ? qa('[data-slot="about-origin"]', origins) : [];
  const originTile = originItems[0] ? originItems[0].firstElementChild : null;
  const originCaption = originItems[0] ? q("p", originItems[0]) : null;

  /* ---- 02 ---- */
  const criteria = sectionOf("criteria");
  const cards = q('[data-slot="value-cards"]');
  const cardItems = cards ? qa('[data-slot="value-card"]', cards) : [];
  const cardTitle = cardItems[0] ? qa("p", cardItems[0])[0] : null;
  const cardBody = cardItems[0] ? qa("p", cardItems[0])[1] : null;
  const note = criteria ? q('[data-slot="section-note"]', criteria) : null;

  /* ---- chapter break ---- */
  const chapter = q('[data-slot="chapter-break"]');
  const chapterInner = chapter ? chapter.firstElementChild : null;
  const chapterBody = chapterInner ? chapterInner.firstElementChild : null;
  const chapterOverline = chapter ? q('[data-slot="overline"]', chapter) : null;
  const chapterPs = chapter ? qa("p", chapter) : [];

  /* ---- 03 / 05 ---- */
  const howRows = qa('[data-slot="about-how"] [data-slot="step-row"]');
  const attRows = qa('[data-slot="about-attitude"] [data-slot="step-row"]');
  const stepFacts = (rows) => {
    if (rows.length === 0) return null;
    const first = rows[0];
    const spans = qa("span", first);
    const c = cs(first);
    return {
      count: rows.length,
      rowBox: boxOf(first),
      rowPitch: rows.length > 1 ? r2(box(rows[1]).top - box(first).top) : null,
      paddingTop: px(c.paddingTop),
      paddingBottom: px(c.paddingBottom),
      borderTopWidth: px(c.borderTopWidth),
      borderTopColor: hex(c.borderTopColor),
      stepCol: boxOf(spans[0]),
      nameCol: boxOf(spans[1]),
      bodyCol: boxOf(spans[2]),
      stepType: type(spans[0]),
      nameType: type(spans[1]),
      bodyType: type(spans[2]),
    };
  };

  /* ---- 04 ---- */
  const makers = sectionOf("makers");
  const makerGrid = makers ? q('[data-slot="catalog-grid"]', makers) : null;
  const makerCards = makerGrid ? qa('[data-slot="catalog-card"]', makerGrid) : [];
  const makerImage = makerCards[0] ? makerCards[0].firstElementChild : null;

  /* ---- 06 ---- */
  const companyRows = qa('[data-slot="about-company"] [data-slot="meta-row"]');
  const companyFacts = () => {
    if (companyRows.length === 0) return null;
    const first = companyRows[0];
    const c = cs(first);
    const dt = q("dt", first);
    const dd = q("dd", first);
    return {
      count: companyRows.length,
      rowBox: boxOf(first),
      rowPitch: companyRows.length > 1 ? r2(box(companyRows[1]).top - box(first).top) : null,
      paddingTop: px(c.paddingTop),
      paddingBottom: px(c.paddingBottom),
      gapCol: px(c.columnGap),
      borderTopWidth: px(c.borderTopWidth),
      borderTopColor: hex(c.borderTopColor),
      term: boxOf(dt),
      value: boxOf(dd),
      termType: type(dt),
      valueType: type(dd),
      valueLeftOffset: (() => {
        const rb = box(first), db = box(dd);
        return rb && db ? r2(db.left - rb.left) : null;
      })(),
      stacked: (() => {
        const a = box(dt), b = box(dd);
        return a && b ? b.top > a.top + 2 : null;
      })(),
      values: companyRows.map((r) => (q("dd", r).textContent || "").trim()),
    };
  };

  /* ---- quiet links ---- */
  const quiet = q('[data-slot="about-quiet-links"]');
  const quietLinks = quiet ? qa("a", quiet) : [];

  return {
    page: { ...pageColors(), ...overflow() },
    header: boxOf(header),
    breadcrumb: {
      box: boxOf(crumb),
      headerToCrumb: gapY(header, crumb),
      crumbToStatement: gapY(crumb, stOverline),
    },
    statement: {
      section: secFacts(statement),
      overline: type(stOverline),
      overlineBox: boxOf(stOverline),
      title: type(stTitle),
      titleBox: boxOf(stTitle),
      overlineToTitle: gapY(stOverline, stTitle),
      titleToLead: gapY(stTitle, stLead),
      lead: type(stLeadP[0]),
      leadBox: boxOf(stLead),
      leadParagraphs: stLeadP.length,
      leadToIndex: gapY(stLead, index),
    },
    index: {
      surface: surface(index),
      ul: surface(indexUl),
      count: indexItems.length,
      grid: gridFacts(indexUl),
      itemBoxes: indexItems.map((li) => boxOf(li)),
      linkType: type(indexLinks[0]),
      linkBoxes: indexLinks.map((a) => boxOf(a)),
      hrefs: indexLinks.map((a) => a.getAttribute("href")),
      indexToUs: gapY(index, us),
    },
    us: {
      section: secFacts(us),
      head: headFacts(us),
      titleToBody: (() => {
        const h = headOf(us);
        const t = h ? q('[data-slot="section-title"]', h) : null;
        return gapY(t, usBody);
      })(),
      bodyType: type(usBodyP[0]),
      bodyParagraphs: usBodyP.length,
      bodyGap: usBodyP.length > 1 ? gapY(usBodyP[0], usBodyP[1]) : null,
      bodyBox: boxOf(usBody),
      figure: boxOf(usFigure),
      image: surface(usImage),
      imageAspect: (() => {
        const b = box(usImage);
        return b && b.height ? r2(b.width / b.height) : null;
      })(),
      textToFigureGapX: gapX(usBody, usFigure),
    },
    origins: {
      overline: type(originsOverline),
      overlineToGrid: gapY(originsOverline, origins),
      grid: gridFacts(origins),
      tile: surface(originTile),
      tileAspect: (() => {
        const b = box(originTile);
        return b && b.height ? r2(b.width / b.height) : null;
      })(),
      caption: type(originCaption),
      tileToCaption: gapY(originTile, originCaption),
      count: originItems.length,
    },
    criteria: {
      section: secFacts(criteria),
      head: headFacts(criteria),
      titleToCards: (() => {
        const h = headOf(criteria);
        const t = h ? q('[data-slot="section-title"]', h) : null;
        return gapY(t, cards);
      })(),
      grid: gridFacts(cards),
      card: surface(cardItems[0]),
      cardTitle: type(cardTitle),
      cardBody: type(cardBody),
      cardTitleToBody: gapY(cardTitle, cardBody),
      cardTextAlign: cardItems[0] ? cs(cardItems[0]).textAlign : null,
      cardsToNote: gapY(cards, note),
      note: type(note),
      noteBox: boxOf(note),
    },
    chapter: {
      surface: surface(chapter),
      inner: surface(chapterInner),
      innerContent: surface(chapterBody),
      overline: type(chapterOverline),
      title: type(chapterPs[1]),
      body: type(chapterPs[2]),
      overlineToTitle: gapY(chapterPs[0], chapterPs[1]),
      titleToBody: gapY(chapterPs[1], chapterPs[2]),
      textAlign: chapterBody ? cs(chapterBody).textAlign : null,
    },
    how: {
      section: secFacts(sectionOf("how")),
      head: headFacts(sectionOf("how")),
      rows: stepFacts(howRows),
    },
    attitude: {
      section: secFacts(sectionOf("attitude")),
      head: headFacts(sectionOf("attitude")),
      rows: stepFacts(attRows),
    },
    makers: {
      present: Boolean(makers),
      section: secFacts(makers),
      head: headFacts(makers),
      grid: gridFacts(makerGrid),
      gridOverflowX: makerGrid ? cs(makerGrid).overflowX : null,
      gridDisplay: makerGrid ? cs(makerGrid).display : null,
      cardCount: makerCards.length,
      card: surface(makerCards[0]),
      cardPitch:
        makerCards.length > 1 ? r2(box(makerCards[1]).left - box(makerCards[0]).left) : null,
      image: surface(makerImage),
      imageAspect: (() => {
        const b = box(makerImage);
        return b && b.height ? r2(b.width / b.height) : null;
      })(),
      overline: type(makerCards[0] ? q('[data-slot="overline"]', makerCards[0]) : null),
      title: type(makerCards[0] ? q('[data-slot="catalog-card-title"]', makerCards[0]) : null),
      hrefs: makerCards.map((c) => c.getAttribute("href")),
    },
    company: {
      section: secFacts(sectionOf("company")),
      head: headFacts(sectionOf("company")),
      titleToRows: (() => {
        const h = headOf(sectionOf("company"));
        const t = h ? q('[data-slot="section-title"]', h) : null;
        return gapY(t, q('[data-slot="about-company"]'));
      })(),
      rows: companyFacts(),
    },
    quiet: {
      section: secFacts(quiet ? quiet.closest('[data-slot="page-section"]') : null),
      count: quietLinks.length,
      boxes: quietLinks.map((a) => boxOf(a)),
      type: type(quietLinks[0]),
      hrefs: quietLinks.map((a) => a.getAttribute("href")),
      pitchX:
        quietLinks.length > 1 ? r2(box(quietLinks[1]).left - box(quietLinks[0]).left) : null,
      pitchY:
        quietLinks.length > 1 ? r2(box(quietLinks[1]).top - box(quietLinks[0]).top) : null,
    },
    sectionPaddings: sections.map((s) => ({
      id: s.id || null,
      slot: s.getAttribute("data-slot"),
      pt: px(cs(s).paddingTop),
      pb: px(cs(s).paddingBottom),
      h: r2(box(s).height),
    })),
  };
`);

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

const results = { base: BASE, path: ABOUT_PATH };
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

for (const [label, width, height] of [
  ["pc", 1440, 900],
  ["sp", 390, 844],
]) {
  await page.setViewportSize({ width, height });
  const res = await page.goto(`${BASE}${ABOUT_PATH}`, { waitUntil: "networkidle" });
  results[`about_${label}_status`] = res?.status() ?? null;
  await page.waitForTimeout(700);
  results[`about_${label}`] = await page.evaluate(aboutProbe);
  await page.screenshot({ path: `${SHOT}/about-${label}.` + "png", fullPage: true });
}

// mokuji anchors: sticky header の下に見出しが出るか
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}${ABOUT_PATH}`, { waitUntil: "networkidle" });
const anchorChecks = [];
for (const id of ["us", "criteria", "how", "makers", "attitude", "company"]) {
  const found = await page.evaluate((sectionId) => {
    const target = document.getElementById(sectionId);
    if (!target) return false;
    target.scrollIntoView();
    return true;
  }, id);
  if (!found) {
    anchorChecks.push({ id, present: false });
    continue;
  }
  await page.waitForTimeout(250);
  anchorChecks.push(
    await page.evaluate((sectionId) => {
      const target = document.getElementById(sectionId);
      const header = document.querySelector("header");
      const head = target.querySelector('[data-slot="about-section-head"]');
      const hb = header.getBoundingClientRect();
      const tb = (head ?? target).getBoundingClientRect();
      return {
        id: sectionId,
        present: true,
        headerBottom: Math.round(hb.bottom),
        headTop: Math.round(tb.top),
        visibleBelowHeader: tb.top >= hb.bottom,
      };
    }, id),
  );
}
results.anchors = anchorChecks;

results.console = consoleLog;
await browser.close();

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
console.log("console errors/warnings/pageerrors:", consoleLog.length);
