// C13-1 テイスティングノート / メンバーシップ転送 実画面 getComputedStyle 実測ハーネス
//
// 対比表の「実装値」を、実際にレンダリングされた DOM の computed 値 /
// bounding box から取る。作法は scripts/c91-measure.mjs に合わせた。
//
// 色は **canvas のピクセル値**で読む。Chromium は getComputedStyle の色を
// lab() / oklch() のまま返すことがあり、文字列パースでは嘘の値になる
// (C6-1R レーンの実証済み知見)。canvas の fillStyle に食わせて 1px 塗り、
// getImageData で sRGB バイトを読めば必ず #rrggbb に落ちる。
//
// 測る対象:
//   1. /ja/tasting-note  R2 正本 = お茶カルテ R2 の TastingNotes ブロック
//      (PC 8105:1125 / SP 8105:1262)。PREVIEW_SEED=1 で見本 4 件を出して測る
//   2. /ja/membership    308 で /ja/subscription へ着くか (R2 決定 = ページ廃止)
//   3. /ja/subscription  転送先のプラン選択節 (PC 8071:514 / SP 8073:186) が
//      R2 どおり「頻度 + 内容 + CTA 1 個」になっているか
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3183";
const OUT = process.env.C13_OUT ?? "/tmp/c13-measure.json";
const SHOT = "/tmp/c13-shots";
fs.mkdirSync(SHOT, { recursive: true });

const HELPERS = `
  const px = (v) => (v == null || v === "" ? null : Math.round(parseFloat(v) * 100) / 100);
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const box = (el) => (el ? el.getBoundingClientRect() : null);
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => [...root.querySelectorAll(s)];

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

  const gapY = (a, b) => {
    const A = box(a), B = box(b);
    if (!A || !B) return null;
    return r2(B.top - A.bottom);
  };
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
      text: (el.textContent || "").trim().slice(0, 28),
      ...boxOf(el),
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
      borderStyle: c.borderTopStyle,
      radius: px(c.borderTopLeftRadius),
      padding: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].map(px),
      gapRow: c.rowGap === "normal" ? null : px(c.rowGap),
      gapCol: c.columnGap === "normal" ? null : px(c.columnGap),
      display: c.display,
      gridTemplateColumns: c.gridTemplateColumns,
      alignItems: c.alignItems,
    };
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
/* /ja/tasting-note — 飲んだ記録の一覧                                         */
/* -------------------------------------------------------------------------- */

const tastingProbe = `(() => {
${HELPERS}
  const sec = q('[data-slot="section"]');
  const crumbNav = q('nav[aria-label="Breadcrumb"]');
  const head = q('[data-slot="list-page-head"]');
  const headPs = head ? qa("p", head) : [];
  const overline = headPs[0] ?? null;
  const h1 = q("h1");
  const lead = headPs.length > 1 ? headPs[headPs.length - 1] : null;

  const list = q('[data-slot="tasting-note-list"]');
  const cards = qa('[data-slot="diary-card"]');
  const c0 = cards[0] ?? null;
  const photo0 = c0 ? q('[data-slot="diary-photo"]', c0) : null;
  const body0 = c0 ? q('[data-slot="diary-body"]', c0) : null;
  const bodyPs = body0 ? [...body0.children] : [];
  const date0 = bodyPs[0] ?? null;
  const title0 = bodyPs[1] ?? null;
  const note0 = c0 ? q('[data-slot="diary-note"]', c0) : null;
  const chip0 = c0 ? q('[data-slot="diary-chip"]', c0) : null;

  // 3 枚目は「記録だけ」= 線のチップ (R2 8105:1149 / 8105:1289)
  const c2 = cards[2] ?? null;
  const chip2 = c2 ? q('[data-slot="diary-chip"]', c2) : null;

  const more = q('[data-slot="tasting-note-more"]');
  const outro = q('[data-slot="tasting-note-outro"]');
  const outroLink = outro ? q("a", outro) : null;
  const emptyNote = list ? null : (sec ? qa("p", sec).slice(-1)[0] ?? null : null);

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    ...overflow(),
    ...pageColors(),
    section: surface(sec),
    breadcrumbPresent: !!crumbNav,
    head: {
      box: boxOf(head),
      overline: type(overline),
      h1: type(h1),
      lead: type(lead),
      gapOverlineToH1: gapY(overline, h1),
      gapH1ToLead: gapY(h1, lead),
    },
    list: {
      present: !!list,
      count: cards.length,
      surface: surface(list),
      gapHeadToList: gapY(head, list),
      gapCardToCard: cards.length > 1 ? gapY(cards[0], cards[1]) : null,
    },
    card0: {
      surface: surface(c0),
      photo: surface(photo0),
      body: surface(body0),
      date: type(date0),
      title: type(title0),
      note: type(note0),
      gapDateToTitle: gapY(date0, title0),
      gapTitleToNote: gapY(title0, note0),
      gapPhotoToBody: gapX(photo0, body0),
      chip: { ...surface(chip0), ...type(chip0) },
      chipRightEdgeToCardRight: (() => {
        const A = box(chip0), B = box(c0);
        if (!A || !B) return null;
        return r2(B.right - A.right);
      })(),
      noteLeftMinusBodyLeft: (() => {
        const A = box(note0), B = box(body0);
        if (!A || !B) return null;
        return r2(A.left - B.left);
      })(),
    },
    chipOutlined: { ...surface(chip2), ...type(chip2) },
    more: more ? { ...type(more) } : null,
    outro: {
      wrapper: surface(outro),
      link: outroLink ? { ...type(outroLink), ...boxOf(outroLink) } : null,
      centered: (() => {
        const A = box(outroLink);
        if (!A) return null;
        return r2(Math.abs((A.left + A.right) / 2 - window.innerWidth / 2));
      })(),
      minHeight: outroLink ? px(cs(outroLink).minHeight) : null,
    },
    emptyState: emptyNote ? type(emptyNote) : null,
  };
})()`;

/* -------------------------------------------------------------------------- */
/* /ja/subscription — 転送先のプラン選択節 (R2 8071:514 / 8073:186)             */
/* -------------------------------------------------------------------------- */

const planProbe = `(() => {
${HELPERS}
  // 最下部の申し込みブロック (R2 の「プラン選択 + 購入導線」= 中央 528 幅)。
  const lp = q('[data-slot="subscription-lp"]');
  const signup = q('.max-w-132');
  // ティア語 = 消えた会員ランク制度の痕跡。1 件も出ないことを確認する。
  const tierWords = ["メンバーシッププラン", "現在のプラン", "スタンダード", "プレミアム"];
  const bodyText = document.body.innerText;
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    ...overflow(),
    lpPresent: !!lp,
    signupBlock: surface(signup),
    // 申し込みブロック内の submit ボタン (R2 は CTA 1 個)
    signupSubmitCount: signup ? qa('button[type="submit"], a[href*="cart"]', signup).length : null,
    tierWordsFound: tierWords.filter((w) => bodyText.includes(w)),
  };
})()`;

/* -------------------------------------------------------------------------- */

const results = {};
const consoleLog = [];
const requestFailed = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "ja-JP" });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") {
    consoleLog.push(`${m.type()}: ${m.text()}`);
  }
});
page.on("pageerror", (e) => consoleLog.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) =>
  requestFailed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`),
);

for (const [label, width, height] of [
  ["pc", 1440, 1000],
  ["sp", 375, 1200],
]) {
  await page.setViewportSize({ width, height });

  // 1. テイスティングノート
  const r1 = await page.goto(`${BASE}/ja/tasting-note`, { waitUntil: "networkidle" });
  results[`tasting_${label}_status`] = r1?.status() ?? null;
  await page.waitForTimeout(700);
  results[`tasting_${label}`] = await page.evaluate(tastingProbe);
  await page.screenshot({ path: `${SHOT}/tasting-${label}.png`, fullPage: true });

  // 2. メンバーシップ = 恒久転送
  const r2res = await page.goto(`${BASE}/ja/membership`, { waitUntil: "networkidle" });
  results[`membership_${label}`] = {
    finalUrl: page.url(),
    finalStatus: r2res?.status() ?? null,
    redirectChain: (() => {
      const chain = [];
      let req = r2res?.request();
      while (req) {
        chain.unshift({ url: req.url(), status: null });
        req = req.redirectedFrom();
      }
      return chain.map((c) => c.url);
    })(),
    landedOnSubscription: page.url().includes("/ja/subscription"),
  };

  // 3. 転送先のプラン選択節
  results[`plan_${label}`] = await page.evaluate(planProbe);
  await page.screenshot({ path: `${SHOT}/plan-${label}.png`, fullPage: true });
}

// 転送のステータスコードは redirect を追わずに 1 回で確認する
const noRedirect = await ctx.request.get(`${BASE}/ja/membership`, {
  maxRedirects: 0,
});
results.membership_raw = {
  status: noRedirect.status(),
  location: noRedirect.headers()["location"] ?? null,
};
const noRedirectEn = await ctx.request.get(`${BASE}/en/membership`, {
  maxRedirects: 0,
});
results.membership_raw_en = {
  status: noRedirectEn.status(),
  location: noRedirectEn.headers()["location"] ?? null,
};
// アンケートの退避先が生きているか
const feedback = await ctx.request.get(`${BASE}/ja/tasting-note/feedback`);
results.feedback_status = feedback.status();

results.console = consoleLog;
results.requestFailedCount = requestFailed.length;
results.requestFailedSample = requestFailed.slice(0, 5);

await browser.close();
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
console.log("console errors/warnings/pageerrors:", consoleLog.length);
