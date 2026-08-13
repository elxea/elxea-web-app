// C7-1 イベント詳細 実画面 getComputedStyle 実測ハーネス
// 対比表の「実装値」を、実際にレンダリングされた DOM の computed 値 /
// bounding box から取る (トークンやクラスの解決値ではなく実測)。
// 作法は scripts/c25-measure.mjs (C2.5) に合わせた。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3971";
const PATH = process.env.C71_PATH ?? "/ja/events/seed-event-1";
const OUT = process.env.C71_OUT ?? "/tmp/c71-measure.json";
const SHOT = "/tmp/c71-shots";
fs.mkdirSync(SHOT, { recursive: true });

const probe = () => {
  const px = (v) => (v == null ? null : Math.round(parseFloat(v) * 100) / 100);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const box = (el) => (el ? el.getBoundingClientRect() : null);
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => [...root.querySelectorAll(s)];

  /** 2 要素の縦の隙間 (上の下端 → 下の上端) */
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
      lineHeight: c.lineHeight === "normal" ? "normal" : px(c.lineHeight),
      color: c.color,
      textAlign: c.textAlign,
    };
  };

  const boxOf = (el) => {
    const B = box(el);
    if (!B) return null;
    return {
      w: Math.round(B.width * 100) / 100,
      h: Math.round(B.height * 100) / 100,
      x: Math.round(B.left * 100) / 100,
      y: Math.round(B.top * 100) / 100,
    };
  };

  const surface = (el) => {
    const c = cs(el);
    if (!c) return null;
    return {
      ...boxOf(el),
      background: c.backgroundColor,
      borderWidth: px(c.borderTopWidth),
      borderColor: c.borderTopColor,
      borderTopWidth: px(c.borderTopWidth),
      radius: px(c.borderTopLeftRadius),
      padding: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].map(px),
      gap: c.rowGap === "normal" ? null : px(c.rowGap),
    };
  };

  const sec = q('[data-slot="event-detail-page"]');
  const crumb = q('nav[aria-label="Breadcrumb"]');
  const stack = q('[data-slot="event-detail-stack"]');
  const header = q('[data-slot="event-detail-header"]');
  const eyebrow = q('[data-slot="event-eyebrow"]');
  const badge = q('[data-slot="event-eyebrow"] [data-slot="badge"]');
  const h1 = q("h1");
  const factCard = q('[data-slot="event-fact-card"]');
  const rows = qa('[data-slot="event-fact-row"]');
  const divider = q('[data-slot="event-fact-divider"]');
  const hero = q('[data-slot="event-hero"]');
  const regCard = q('[data-slot="event-registration-card"]');
  const regBtn = regCard ? q("button", regCard) : null;
  const regNote = q('[data-slot="event-registration-note"]');
  const body = q('[data-slot="event-body"]');
  const bodyHead = q('h2[data-slot="event-section-title"]');
  // 本文枠は `ArticleProse` (data-slot="article-prose")。以前は `.prose-custom` を
  // 探していたが、そのクラスは CSS に一度も存在せず、要素側の className からも
  // 外したのでセレクタが空振りしていた (計測値が常に null になる)。
  const bodyProse = body ? q('[data-slot="article-prose"]', body) : null;
  const detailsLink = q('[data-slot="event-details-link"]');
  const secCS = cs(sec);

  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    horizontalOverflow: {
      docScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      overflows: document.documentElement.scrollWidth > window.innerWidth,
    },
    page: {
      contentWidth: boxOf(sec)?.w ?? null,
      leftOffset: sec ? Math.round(box(sec).left + parseFloat(cs(sec).paddingLeft)) : null,
      paddingTop: px(secCS?.paddingTop),
      paddingBottom: px(secCS?.paddingBottom),
      paddingLeft: px(secCS?.paddingLeft),
      maxWidth: px(secCS?.maxWidth),
    },
    breadcrumb: {
      ...boxOf(crumb),
      marginBottom: px(cs(crumb)?.marginBottom),
      gapToStack: gap(crumb, stack),
      type: type(q("li", crumb)),
    },
    stack: { gap: px(cs(stack)?.rowGap), ...boxOf(stack) },
    stackGaps: {
      headerToHero: gap(header, hero),
      heroToReg: gap(hero, regCard),
      regToBody: gap(regCard, body),
    },
    header: {
      gap: px(cs(header)?.rowGap),
      ...boxOf(header),
      gapEyebrowToTitle: gap(eyebrow, h1),
      gapTitleToCard: gap(h1, factCard),
    },
    eyebrow: {
      gap: px(cs(eyebrow)?.columnGap),
      label: type(q("span", eyebrow)),
      badge: badge
        ? {
            ...surface(badge),
            type: type(badge),
          }
        : null,
    },
    title: { ...type(h1), ...boxOf(h1) },
    factCard: {
      ...surface(factCard),
      rowCount: rows.length,
      rowLabel: type(q("dt", rows[0])),
      rowValue: type(q("dd", rows[0])),
      rowGapMeasured: rows[1] ? gap(rows[0], divider) : null,
      divider: divider
        ? { h: boxOf(divider).h, w: boxOf(divider).w, background: cs(divider).backgroundColor }
        : null,
    },
    hero: hero
      ? {
          ...boxOf(hero),
          ratio: Math.round((boxOf(hero).w / boxOf(hero).h) * 1000) / 1000,
          radius: px(cs(hero).borderTopLeftRadius),
          imgFit: q("img", hero) ? cs(q("img", hero)).objectFit : null,
        }
      : null,
    registration: {
      ...surface(regCard),
      button: regBtn
        ? {
            ...surface(regBtn),
            type: type(regBtn),
            text: regBtn.textContent.trim(),
            svgCount: qa("svg", regBtn).length,
          }
        : null,
      note: regNote ? { ...boxOf(regNote), type: type(regNote), text: regNote.textContent.trim() } : null,
      gapBtnToNote: gap(regBtn, regNote),
    },
    body: body
      ? {
          gap: px(cs(body).rowGap),
          ...boxOf(body),
          heading: { ...type(bodyHead), ...boxOf(bodyHead), text: bodyHead?.textContent.trim() },
          gapHeadToProse: gap(bodyHead, bodyProse),
          prose: bodyProse ? { ...boxOf(bodyProse), type: type(q("p", bodyProse)) } : null,
          gapProseToLink: gap(bodyProse, detailsLink),
          detailsLink: detailsLink
            ? { ...surface(detailsLink), type: type(detailsLink), text: detailsLink.textContent.trim() }
            : null,
        }
      : null,
  };
};

const stickyProbe = () => {
  const bar = document.querySelector('[data-slot="event-sticky-register-bar"]');
  if (!bar) return { present: false };
  const c = getComputedStyle(bar);
  const b = bar.getBoundingClientRect();
  const btn = bar.querySelector("button");
  const bb = btn?.getBoundingClientRect();
  return {
    present: true,
    position: c.position,
    h: Math.round(b.height * 100) / 100,
    w: Math.round(b.width * 100) / 100,
    bottom: Math.round((window.innerHeight - b.bottom) * 100) / 100,
    background: c.backgroundColor,
    borderTopWidth: c.borderTopWidth,
    borderTopColor: c.borderTopColor,
    padding: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft],
    display: c.display,
    button: bb
      ? { h: Math.round(bb.height * 100) / 100, w: Math.round(bb.width * 100) / 100, text: btn.textContent.trim() }
      : null,
  };
};

const results = {};
const consoleLog = [];

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "ja-JP", timezoneId: "Asia/Tokyo" });
const page = await context.newPage();

page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) {
    consoleLog.push({ type: msg.type(), text: msg.text() });
  }
});
page.on("pageerror", (err) => consoleLog.push({ type: "pageerror", text: String(err) }));
page.on("requestfailed", (req) =>
  consoleLog.push({ type: "requestfailed", text: `${req.url()} ${req.failure()?.errorText ?? ""}` }),
);

for (const [label, width, height] of [
  ["pc", 1440, 900],
  ["sp", 390, 844],
]) {
  await page.setViewportSize({ width, height });
  const res = await page.goto(`${BASE}${PATH}`, { waitUntil: "networkidle" });
  results[`${label}_status`] = res?.status() ?? null;
  await page.waitForTimeout(600);
  results[label] = await page.evaluate(probe);

  // 追従バーは「登録カードもページ末尾も見えていない」位置でだけ出る仕様。
  // 上端 (登録カード未通過) / 中間 / 最下部の 3 点で挙動を測る。
  results[`${label}_sticky_top`] = await page.evaluate(stickyProbe);
  // 追従バーは「登録カードが視界に無い」ときだけ出る。判定は絶対座標
  // (getBoundingClientRect + window.scrollY) で行い、scrollIntoView は使わない。
  const stickyWindow = await page.evaluate(() => {
    const reg = document.querySelector('[data-slot="event-registration-card"]');
    const footer = document.querySelector("footer");
    if (!reg) return null;
    const r = reg.getBoundingClientRect();
    const regTopAbs = r.top + window.scrollY;
    const regBottomAbs = r.bottom + window.scrollY;
    const footerTopAbs = footer
      ? footer.getBoundingClientRect().top + window.scrollY
      : null;
    // 登録カードが視界外になる最小 scroll = カード下端 (上に抜ける)
    const target = Math.round(regBottomAbs + 8);
    window.scrollTo(0, target);
    return {
      regTopAbs: Math.round(regTopAbs),
      regBottomAbs: Math.round(regBottomAbs),
      footerTopAbs: footerTopAbs === null ? null : Math.round(footerTopAbs),
      innerHeight: window.innerHeight,
      docHeight: document.body.scrollHeight,
      scrolledTo: target,
      // 参考: フッターも隠す設計にした場合に出せる scroll 窓 (負なら一度も出ない)
      footerRuleUsableWindow:
        footerTopAbs === null
          ? null
          : Math.round(footerTopAbs - window.innerHeight - regBottomAbs),
    };
  });
  results[`${label}_sticky_window`] = stickyWindow;
  await page.waitForTimeout(500);
  results[`${label}_sticky_mid`] = await page.evaluate(stickyProbe);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  results[`${label}_sticky_bottom`] = await page.evaluate(stickyProbe);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOT}/${label}.png`, fullPage: true });
}

// 一覧 → 詳細の遷移が成立するか (見本カードのリンク先)
await page.setViewportSize({ width: 1440, height: 900 });
const listRes = await page.goto(`${BASE}/ja/events`, { waitUntil: "networkidle" });
results.list_status = listRes?.status() ?? null;
results.list_links = await page.evaluate(() =>
  [...document.querySelectorAll('a[href*="/events/"]')].map((a) => a.getAttribute("href")),
);
const firstDetail = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="/events/"]')][0];
  return a ? a.getAttribute("href") : null;
});
if (firstDetail) {
  let navError = null;
  try {
    await Promise.all([
      page.waitForURL(`**${firstDetail}`, { timeout: 15000 }),
      page.click(`a[href="${firstDetail}"]`),
    ]);
    await page.waitForLoadState("networkidle");
  } catch (err) {
    navError = String(err).split("\n")[0];
  }
  results.list_to_detail = {
    clickedHref: firstDetail,
    landedUrl: page.url(),
    navError,
    h1: await page.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? null),
    registrationCardPresent: await page.evaluate(
      () => !!document.querySelector('[data-slot="event-registration-card"]'),
    ),
  };
}

results.console = consoleLog;
await browser.close();

fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${OUT}`);
console.log("console errors/warnings:", consoleLog.length);
