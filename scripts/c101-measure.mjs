// C10-1 お問い合わせ / プライバシーポリシー 実画面 実測ハーネス
//
// 対比表の「実装値」を、実際にレンダリングされた DOM の computed 値 /
// bounding box から取る (クラス名やトークンの見かけの解決値ではなく実測)。
// 作法は scripts/c91-measure.mjs / scripts/c71-measure.mjs に合わせた。
//
// 色は **canvas のピクセル値**で読む。Chromium は getComputedStyle の色を
// lab() / oklch() のまま返すことがあり、文字列パースでは嘘の値になる
// (C6-1R レーンの実証済み知見)。canvas の fillStyle に食わせて 1px 塗り、
// getImageData で sRGB バイトを読めば必ず #rrggbb に落ちる。
//
// 送信ボタンは**押さない**。フォームは checkValidity() で状態だけ読む
// (外部送信の禁止をハーネス側でも担保する)。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3972";
const OUT = process.env.C101_OUT ?? "/tmp/c101-measure.json";
const SHOT_DIR = process.env.C101_SHOT_DIR ?? "/tmp/c101-shots";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const CONTACT_PATH = process.env.C101_CONTACT_PATH ?? "/ja/contact";
const PRIVACY_PATH = process.env.C101_PRIVACY_PATH ?? "/ja/legal/privacy";

/* -------------------------------------------------------------------------- */
/* 共通ヘルパ (ページ内で eval される文字列にするため関数を文字列化して注入)   */
/* -------------------------------------------------------------------------- */

const HELPERS = `
  const px = (v) => (v == null || v === "" ? null : Math.round(parseFloat(v) * 100) / 100);
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const box = (el) => (el ? el.getBoundingClientRect() : null);
  const q = (s, root = document) => (root ? root.querySelector(s) : null);
  const qa = (s, root = document) => (root ? [...root.querySelectorAll(s)] : []);

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

  /** 2 要素の縦の隙間 (上の下端 → 下の上端) */
  const gapY = (a, b) => {
    const A = box(a), B = box(b);
    if (!A || !B) return null;
    return r2(B.top - A.bottom);
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
      text: (el.textContent || "").trim().slice(0, 32),
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
      borderColor: hex(c.borderTopColor),
      radius: px(c.borderTopLeftRadius),
      padding: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].map(px),
      gapRow: c.rowGap === "normal" ? null : px(c.rowGap),
      gapCol: c.columnGap === "normal" ? null : px(c.columnGap),
      display: c.display,
      gridTemplateColumns: c.gridTemplateColumns,
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
/* お問い合わせ (R2 確定版 PC 8109:46653 / SP 8109:46734)                      */
/* -------------------------------------------------------------------------- */

const contactProbe = `(() => {
${HELPERS}
  const secs = qa('[data-slot="section"]');
  const s1 = secs[0] ?? null;
  const s2 = secs[1] ?? null;
  const s3 = secs[2] ?? null;
  const chapter = q('[data-slot="chapter-break"]');

  // --- S1 ---
  const crumb = q('nav[aria-label="Breadcrumb"]', s1) || q("nav", s1);
  const overline = q('[data-slot="overline"]', s1);
  const h1 = q("h1", s1);
  const lead = h1 ? h1.nextElementSibling : null;
  const metaNote = q('[data-slot="note"]', s1);
  const metaDl = q("dl", s1);
  const metaRows = qa('[data-slot="meta-row"]', s1);
  const mr0 = metaRows[0] ?? null;
  const mr0dt = q("dt", mr0);
  const mr0dd = q("dd", mr0);

  // --- S2 ---
  const s2h = q("h2", s2);
  const s2lead = s2h ? s2h.nextElementSibling : null;
  const linkRows = qa('[data-slot="link-row"]', s2);
  const lr0 = linkRows[0] ?? null;
  const lr0kids = lr0 ? [...lr0.children] : [];

  // --- S3 ---
  const s3h = q("h2", s3);
  const s3lead = s3h ? s3h.nextElementSibling : null;
  const form = q('[data-slot="contact-form"]', s3);
  const labels = qa('[data-slot="label"]', form);
  const l0 = labels[0] ?? null;
  const l0mark = q("span", l0);
  const select = q('[data-slot="native-select"]', form);
  const selectWrap = q('[data-slot="native-select-wrapper"]', form);
  const inputs = qa('[data-slot="input"]', form);
  const textarea = q('[data-slot="textarea"]', form);
  const submit = q('[data-slot="button"]', form);
  const privacyNote = submit ? submit.previousElementSibling : null;
  const fieldWrap = l0 ? l0.parentElement.parentElement : null;
  const field0 = l0 ? l0.parentElement : null;
  const field1 = labels[1] ? labels[1].parentElement : null;

  const pairRows = qa('[data-slot="pair-row"]', s3);
  const pr0 = pairRows[0] ?? null;
  const pr0kids = pr0 ? [...pr0.children] : [];
  const hintsDl = pr0 ? pr0.closest("dl") : null;
  const hintsHeading = hintsDl ? hintsDl.previousElementSibling : null;
  const notes3 = qa('[data-slot="note"]', s3);
  const hintsNote = notes3.length ? notes3[notes3.length - 1] : null;

  return {
    page: { ...pageColors(), ...overflow() },
    s1: {
      section: surface(s1),
      crumb: boxOf(crumb),
      overline: { ...boxOf(overline), ...type(overline) },
      h1: { ...boxOf(h1), ...type(h1) },
      lead: { ...boxOf(lead), ...type(lead) },
      gap_crumb_overline: gapY(crumb, overline),
      gap_overline_h1: gapY(overline, h1),
      gap_h1_lead: gapY(h1, lead),
      metaNote: { ...boxOf(metaNote), ...type(metaNote) },
      gap_note_firstRow: gapY(metaNote, mr0),
      metaRowCount: metaRows.length,
      metaRow0: surface(mr0),
      metaRow0_dt: { ...boxOf(mr0dt), ...type(mr0dt) },
      metaRow0_dd: { ...boxOf(mr0dd), ...type(mr0dd) },
      metaRow0_labelCol: mr0dt && mr0dd ? r2(box(mr0dd).left - box(mr0dt).left) : null,
      metaDl_borderBottom: metaDl ? px(cs(metaDl).borderBottomWidth) : null,
      metaLabels: metaRows.map((r) => (q("dt", r)?.textContent || "").trim()),
      metaValues: metaRows.map((r) => (q("dd", r)?.textContent || "").trim()),
      gridCols: s1 ? cs(q("div.lg\\\\:grid, div", s1)).gridTemplateColumns : null,
    },
    s2: {
      section: surface(s2),
      h2: { ...boxOf(s2h), ...type(s2h) },
      lead: { ...boxOf(s2lead), ...type(s2lead) },
      gap_h2_lead: gapY(s2h, s2lead),
      gap_lead_firstRow: gapY(s2lead, lr0),
      rowCount: linkRows.length,
      row0: surface(lr0),
      row0_title: { ...boxOf(lr0kids[0]), ...type(lr0kids[0]) },
      row0_arrow: boxOf(lr0kids[1]),
      row0_desc: { ...boxOf(lr0kids[2]), ...type(lr0kids[2]) },
      row0_titleToDescX:
        lr0kids[0] && lr0kids[2] ? r2(box(lr0kids[2]).left - box(lr0kids[0]).left) : null,
      row0_arrowRightInset:
        lr0 && lr0kids[1] ? r2(box(lr0).right - box(lr0kids[1]).right) : null,
      hrefs: linkRows.map((a) => a.getAttribute("href")),
      titles: linkRows.map((a) => ([...a.children][0]?.textContent || "").trim()),
    },
    s3: {
      section: surface(s3),
      h2: { ...boxOf(s3h), ...type(s3h) },
      lead: { ...boxOf(s3lead), ...type(s3lead) },
      fieldCount: labels.length,
      fieldWrapRowGap: fieldWrap ? px(cs(fieldWrap).rowGap) : null,
      gap_field0_field1: gapY(field0, field1),
      label0: { ...boxOf(l0), ...type(l0) },
      label0_mark: { ...boxOf(l0mark), ...type(l0mark) },
      label0_gapToControl: gapY(l0, selectWrap),
      labelTexts: labels.map((l) => (l.textContent || "").trim()),
      select: surface(select),
      selectWrap: boxOf(selectWrap),
      input0: surface(inputs[0]),
      inputCount: inputs.length,
      textarea: surface(textarea),
      privacyNote: { ...boxOf(privacyNote), ...type(privacyNote) },
      privacyNoteLink: privacyNote ? q("a", privacyNote)?.getAttribute("href") ?? null : null,
      gap_textarea_privacyNote: gapY(textarea, privacyNote),
      gap_privacyNote_submit: gapY(privacyNote, submit),
      submit: { ...surface(submit), ...type(submit) },
      submitVariant: submit ? submit.getAttribute("data-variant") : null,
      submitSize: submit ? submit.getAttribute("data-size") : null,
      hintsHeading: { ...boxOf(hintsHeading), ...type(hintsHeading) },
      hintRowCount: pairRows.length,
      hintRow0: surface(pr0),
      hintRow0_dt: { ...boxOf(pr0kids[0]), ...type(pr0kids[0]) },
      hintRow0_dd: { ...boxOf(pr0kids[1]), ...type(pr0kids[1]) },
      hintRow0_labelCol:
        pr0kids[0] && pr0kids[1] ? r2(box(pr0kids[1]).left - box(pr0kids[0]).left) : null,
      hintRow0_layout: pr0 ? pr0.getAttribute("data-layout") : null,
      hintRow0_tone: pr0 ? pr0.getAttribute("data-tone") : null,
      hintsDl_borderBottom: hintsDl ? px(cs(hintsDl).borderBottomWidth) : null,
      gap_hintsHeading_dl: gapY(hintsHeading, pr0),
      gap_dl_note: gapY(pairRows[pairRows.length - 1] ?? null, hintsNote),
      hintsNote: { ...boxOf(hintsNote), ...type(hintsNote) },
    },
    s4: {
      band: surface(chapter),
      title: { ...boxOf(q("p", chapter)), ...type(q("p", chapter)) },
      body: { ...boxOf(qa("p", chapter)[1]), ...type(qa("p", chapter)[1]) },
      gap_title_body: gapY(q("p", chapter), qa("p", chapter)[1]),
      hasOverline: chapter ? !!q('[data-slot="overline"]', chapter) : null,
    },
  };
})()`;

/* -------------------------------------------------------------------------- */
/* プライバシーポリシー (導出元 利用規約 PC 7848:39102 / SP 7848:39103)         */
/* -------------------------------------------------------------------------- */

const privacyProbe = `(() => {
${HELPERS}
  const secs = qa('[data-slot="section"]');
  const s1 = secs[0] ?? null;
  const s2 = secs[1] ?? null;
  const s4 = secs[2] ?? null;
  const chapter = q('[data-slot="chapter-break"]');

  const overline = q('[data-slot="overline"]', s1);
  const h1 = q("h1", s1);
  const lead = h1 ? h1.nextElementSibling : null;
  const metaNote = q('[data-slot="note"]', s1);
  const metaRows = qa('[data-slot="meta-row"]', s1);

  const nav = q("nav", s2);
  const navOverline = q('[data-slot="overline"]', nav);
  const navItems = qa("li a", nav);
  const navUl = q("ul", nav);
  const clauses = qa("section[id^='clause-']", s2);
  const c0 = clauses[0] ?? null;
  const c0h = q("h2", c0);
  const c0body = c0 ? qa("div", c0)[0] ?? null : null;
  const clauseCol = c0 ? c0.parentElement : null;

  const bizRows = qa('[data-slot="meta-row"]', s4);
  const s4h = q("h3", s4);
  const br0dt = bizRows[0] ? q("dt", bizRows[0]) : null;
  const br0dd = bizRows[0] ? q("dd", bizRows[0]) : null;

  return {
    page: { ...pageColors(), ...overflow() },
    s1: {
      section: surface(s1),
      overline: { ...boxOf(overline), ...type(overline) },
      h1: { ...boxOf(h1), ...type(h1) },
      lead: { ...boxOf(lead), ...type(lead) },
      gap_overline_h1: gapY(overline, h1),
      gap_h1_lead: gapY(h1, lead),
      metaNote: { ...boxOf(metaNote), ...type(metaNote) },
      metaRowCount: metaRows.length,
      metaRow0: surface(metaRows[0]),
      metaRow0_borderTop: metaRows[0] ? px(cs(metaRows[0]).borderTopWidth) : null,
      metaLabels: metaRows.map((r) => (q("dt", r)?.textContent || "").trim()),
    },
    s2: {
      section: surface(s2),
      navOverline: { ...boxOf(navOverline), ...type(navOverline) },
      navLabel: nav ? nav.getAttribute("aria-label") : null,
      navPosition: nav ? cs(nav).position : null,
      navTop: nav ? px(cs(nav).top) : null,
      navBox: boxOf(nav),
      gap_navOverline_ul: gapY(navOverline, navUl),
      navItemCount: navItems.length,
      navItem0: { ...surface(navItems[0]), ...type(navItems[0]) },
      navItem0_minH: navItems[0] ? px(cs(navItems[0]).minHeight) : null,
      navItem0_h: navItems[0] ? r2(box(navItems[0]).height) : null,
      navGroupHeadings: qa("nav p", nav).length,
      navUl_borderBottom: navUl ? px(cs(navUl).borderBottomWidth) : null,
      clauseCount: clauses.length,
      clauseColW: clauseCol ? r2(box(clauseCol).width) : null,
      clauseColGap: clauseCol ? px(cs(clauseCol).rowGap) : null,
      clause0_h: { ...boxOf(c0h), ...type(c0h) },
      clause0_body: { ...boxOf(c0body), ...type(c0body) },
      gap_h_body: gapY(c0h, c0body),
      clause0_hasList: c0 ? !!q("ul", c0) : null,
      anchorsResolve: navItems.every((a) => {
        const id = (a.getAttribute("href") || "").slice(1);
        return !!document.getElementById(id);
      }),
      anchorHrefs: navItems.map((a) => a.getAttribute("href")),
    },
    s3: {
      band: surface(chapter),
      title: { ...boxOf(q("p", chapter)), ...type(q("p", chapter)) },
      body: { ...boxOf(qa("p", chapter)[1]), ...type(qa("p", chapter)[1]) },
      hasOverline: chapter ? !!q('[data-slot="overline"]', chapter) : null,
    },
    s4: {
      section: surface(s4),
      h3: { ...boxOf(s4h), ...type(s4h) },
      rowCount: bizRows.length,
      row0: surface(bizRows[0]),
      row0_labelCol: br0dt && br0dd ? r2(box(br0dd).left - box(br0dt).left) : null,
      labels: bizRows.map((r) => (q("dt", r)?.textContent || "").trim()),
      addressIsPlaceholder: bizRows.some((r) =>
        ((q("dd", r)?.textContent) || "").includes("公開前に差し替え")
      ),
    },
  };
})()`;

/* -------------------------------------------------------------------------- */
/* 実行                                                                        */
/* -------------------------------------------------------------------------- */

const browser = await chromium.launch();
const page = await browser.newPage({ locale: "ja-JP", deviceScaleFactor: 2 });
const results = {};
const consoleLog = [];

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
  ["contact", CONTACT_PATH, contactProbe],
  ["privacy", PRIVACY_PATH, privacyProbe],
]) {
  for (const [label, width, height] of [
    ["pc", 1440, 900],
    ["sp", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    const res = await page.goto(BASE + path, { waitUntil: "networkidle" });
    results[name + "_" + label + "_status"] = res?.status() ?? null;
    await page.waitForTimeout(700);
    results[name + "_" + label] = await page.evaluate(probe);
    await page.screenshot({ path: SHOT_DIR + "/" + name + "-" + label + ".png", fullPage: true });
  }
}

// /contact/business が /contact へリダイレクトするか
await page.setViewportSize({ width: 1440, height: 900 });
const rd = await page.goto(BASE + "/ja/contact/business", { waitUntil: "networkidle" });
results.business_redirect = {
  status: rd?.status() ?? null,
  finalUrl: page.url(),
  redirectedFrom: rd?.request().redirectedFrom()?.url() ?? null,
};

// フォームは checkValidity() で状態だけ読む (**送信ボタンは押さない**)
await page.goto(BASE + CONTACT_PATH, { waitUntil: "networkidle" });
results.form_validity = await page.evaluate(() => {
  const f = document.querySelector('[data-slot="contact-form"]');
  if (!f) return null;
  const req = [...f.querySelectorAll("[required]")].map((el) => ({
    name: el.getAttribute("name"),
    validWhenEmpty: el.checkValidity(),
  }));
  const sel = f.querySelector('select[name="category"]');
  return {
    formValidWhenEmpty: f.checkValidity(),
    requiredFields: req,
    categoryRequired: sel ? sel.hasAttribute("required") : null,
    categoryDefaultValue: sel ? sel.value : null,
    categoryOptions: sel ? [...sel.options].map((o) => o.value) : null,
    submitPressed: false,
  };
});

results.console = consoleLog;
await browser.close();

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log("wrote " + OUT);
console.log("console errors/warnings/pageerrors:", consoleLog.length);
