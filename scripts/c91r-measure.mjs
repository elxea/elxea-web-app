// C9-1R QA 指摘 2 件の実測ハーネス (Playwright 直駆動)
//
// 測るもの:
//  1. 内容量の表示文字列 (`50gg` にならないこと) — **実データと見本データの両方**
//  2. PortableText を含む節と次の節の実測間隔 (最終ブロックの下マージン漏れ)
//     + PortableText 本文の最終ブロックの computed margin-bottom
//
// 同じスクリプトを「修正前ビルド」「修正後ビルド」の 2 つのサーバに当てて A/B を取る。
// 対象 slug はリストページから実データを辿って発見する (ハードコードしない)。
//
// 色は測らない (本レーンは寸法と文字列のみ)。色を測る場合は canvas の
// getImageData でピクセル値を読む作法に従うこと (getComputedStyle は oklch() を返す)。
import { chromium } from "@playwright/test";
import fs from "node:fs";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3972";
const OUT = process.env.C91R_OUT ?? "/tmp/c91r-measure.json";
const LABEL = process.env.C91R_LABEL ?? "unknown";

const VIEWPORTS = [
  { name: "PC", width: 1440, height: 900 },
  { name: "SP", width: 390, height: 844 },
];

/* -------------------------------------------------------------------------- */
/* ページ内で評価する計測本体                                                  */
/* -------------------------------------------------------------------------- */

const MEASURE = `(() => {
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
  const px = (v) => (v == null || v === "" ? null : r2(parseFloat(v)));
  const box = (el) => (el ? el.getBoundingClientRect() : null);
  const qa = (s, root = document) => [...root.querySelectorAll(s)];

  /** 上要素の下端 → 下要素の上端 (bounding box なのでマージンは含まれない) */
  const gapY = (a, b) => {
    const A = box(a), B = box(b);
    if (!A || !B) return null;
    return r2(B.top - A.bottom);
  };

  const label = (el) => {
    if (!el) return null;
    const slot = el.getAttribute && el.getAttribute("data-slot");
    return (el.tagName || "?").toLowerCase() + (slot ? "[" + slot + "]" : "");
  };

  /* --- 1. 内容量 (SpecBand の 定義リスト から「内容量」の値を引く) --------- */
  const netWeight = (() => {
    for (const dt of qa("dt")) {
      const term = (dt.textContent || "").trim();
      if (term !== "内容量") continue;
      // dt の次の要素 (dd) を値とする。SpecBand は dt/dd を対で並べる。
      let dd = dt.nextElementSibling;
      if (!dd || dd.tagName.toLowerCase() !== "dd") {
        // dt/dd が別ラッパに入る組み方も許容する
        dd = dt.parentElement ? dt.parentElement.querySelector("dd") : null;
      }
      if (dd) return (dd.textContent || "").trim();
    }
    return null;
  })();

  /* --- 2a. PortableText 本文の最終ブロックの margin-bottom ---------------- */
  // 共有シリアライザの normal 段落は leading-relaxed クラスを持つ。その親を本文枠と見る。
  const ptContainers = [...new Set(qa("p.leading-relaxed").map((p) => p.parentElement))]
    .filter(Boolean);

  const portableText = ptContainers.map((c) => {
    const kids = [...c.children];
    const last = kids[kids.length - 1] || null;
    const cs = last ? getComputedStyle(last) : null;
    // 漏れの「見え方」を測る: 本文枠を含む節 → 次の節の中身の先頭までの実測間隔
    const sec = c.closest("section") || c.closest('[data-slot="page-section"]');
    const nextSec = sec ? sec.nextElementSibling : null;
    const nextFirst = nextSec ? nextSec.children[0] || nextSec : null;
    return {
      container: label(c),
      containerClass: (c.className || "").toString().slice(0, 120),
      blocks: kids.length,
      lastBlock: label(last),
      lastBlockMarginBottom: cs ? px(cs.marginBottom) : null,
      // 本文枠の下端 → 次の節の中身の先頭 (節をまたぐ実測間隔)
      gapToNextSection: gapY(c, nextFirst),
      nextSectionLabel: label(nextSec),
    };
  });

  /* --- 2b. 節と節の実測間隔 ---------------------------------------------- */
  // 各 page-section / section の「中身の最終要素」→ 次の節の「中身の先頭要素」
  const sections = qa('[data-slot="page-section"]');
  const sectionGaps = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    const aKids = [...a.children], bKids = [...b.children];
    const aLast = aKids[aKids.length - 1] || null;
    const bFirst = bKids[0] || null;
    // 節の見出しキッカー文言で節を識別する (順序に依存しないため)
    const nameOf = (s) => {
      const head = s.querySelector('[data-slot="section-head"] p');
      if (head) return (head.textContent || "").trim();
      if (s.querySelector('[data-slot="tea-hero-info"]')) return "HERO";
      return "(no-head)";
    };
    sectionGaps.push({
      from: nameOf(a),
      to: nameOf(b),
      fromLast: label(aLast),
      toFirst: label(bFirst),
      gap: gapY(aLast, bFirst),
    });
  }

  /* --- 参考: hero 情報カラム → 次節 (QA が測った経路そのもの) ------------- */
  const heroInfo = document.querySelector('[data-slot="tea-hero-info"]');
  const heroSection = heroInfo ? heroInfo.closest('[data-slot="page-section"]') : null;
  let heroToNext = null;
  if (heroSection) {
    const idx = sections.indexOf(heroSection);
    const next = idx >= 0 ? sections[idx + 1] : null;
    const nextHead = next ? next.querySelector('[data-slot="section-head"]') : null;
    const heroKids = [...heroSection.children];
    heroToNext = {
      gap: gapY(heroKids[heroKids.length - 1] || null, nextHead),
      // SP は縦積みなので hero 枠の最終要素 = grid ラッパ
      fromLast: label(heroKids[heroKids.length - 1] || null),
      toFirst: label(nextHead),
    };
  }

  return {
    url: location.pathname,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    // ページ全高。漏れが消えた分だけ縮むので「効いたかどうか」の総量指標になる。
    docHeight: document.documentElement.scrollHeight,
    netWeight,
    portableText,
    sectionGaps,
    heroToNext,
  };
})()`;

/* -------------------------------------------------------------------------- */
/* 対象 slug の発見 (リストページの実データから 1 件目を採る)                   */
/* -------------------------------------------------------------------------- */

async function firstHref(page, listPath, pattern) {
  const res = await page.goto(BASE + listPath, { waitUntil: "networkidle" });
  if (!res || res.status() >= 400) return null;
  const hrefs = await page.evaluate(
    (p) =>
      [...document.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href"))
        .filter((h) => h && new RegExp(p).test(h)),
    pattern
  );
  return hrefs[0] ?? null;
}

async function main() {
  const browser = await chromium.launch();
  const results = [];
  const consoleIssues = [];

  // --- 対象パスの決定 ---
  const probe = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const targets = [];

  // お茶メニュー詳細: 実データ (spring-sencha) と 見本データ (seed-tea-1) の両方
  targets.push({ kind: "tea-menu (実データ)", path: "/ja/tea-menu/spring-sencha" });
  targets.push({ kind: "tea-menu (見本データ)", path: "/ja/tea-menu/seed-tea-1" });

  const discovery = [
    ["記事詳細", "/ja/journal", "^/ja/journal/[^/?#]+$"],
    ["農家詳細", "/ja/farmers", "^/ja/farmers/[^/?#]+$"],
    ["elxea Journal 詳細", "/ja/elxea-journal", "^/ja/elxea-journal/[^/?#]+$"],
    ["プレイリスト詳細", "/ja/playlists", "^/ja/playlists/[^/?#]+$"],
    ["イベント詳細", "/ja/events", "^/ja/events/[^/?#]+$"],
  ];
  for (const [kind, list, pattern] of discovery) {
    const href = await firstHref(probe, list, pattern);
    if (href) targets.push({ kind, path: href });
    else targets.push({ kind, path: null, note: "リストから詳細リンクが見つからない" });
  }
  await probe.close();

  // --- 計測 ---
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning")
        consoleIssues.push({ vp: vp.name, type: m.type(), text: m.text().slice(0, 200) });
    });
    page.on("pageerror", (e) =>
      consoleIssues.push({ vp: vp.name, type: "pageerror", text: String(e).slice(0, 200) })
    );

    for (const t of targets) {
      if (!t.path) {
        results.push({ label: LABEL, vp: vp.name, kind: t.kind, status: null, note: t.note });
        continue;
      }
      const res = await page.goto(BASE + t.path, { waitUntil: "networkidle" });
      const status = res ? res.status() : null;
      if (status !== 200) {
        results.push({ label: LABEL, vp: vp.name, kind: t.kind, path: t.path, status });
        continue;
      }
      // 画像の遅延読み込みが縦位置に影響しないよう最後まで下げてから戻す
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);

      const m = await page.evaluate(MEASURE);
      results.push({ label: LABEL, vp: vp.name, kind: t.kind, path: t.path, status, ...m });
    }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, base: BASE, results, consoleIssues }, null, 2));
  console.log(`[c91r-measure] ${LABEL}: ${results.length} rows -> ${OUT}`);
  console.log(`[c91r-measure] console error/warning: ${consoleIssues.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
