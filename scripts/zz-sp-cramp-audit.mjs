/**
 * zz-sp-cramp-audit.mjs — SP 幅で「横並びが見出しを圧迫している」箇所を実測する。
 *
 * 目視だと「なんとなく狭い」しか言えないので数値で判定する。日本語は 1 文字ずつ
 * 折り返せるため min-content 幅はほぼ 1 文字になり、「潰れているか」の判定には
 * 使えない。代わりに、Setaka の指摘そのもの ——「ボタンが横に並んで**タイトルの
 * 幅を食っている**」—— を測る:
 *
 *   flex-row の中に見出し (h1-h3 / .page-title) と、縮まない兄弟 (flex-shrink:0)
 *   が同居しているとき、見出しが行のうち何 % を使えているか。
 *
 * 併せて、ページ全体の横溢れ (docOverflow) も見る。
 *
 * 使い方: node scripts/zz-sp-cramp-audit.mjs <baseURL>
 * 一時的な計測スクリプト (zz- 接頭辞) であり製品コードではない。
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3241";
const SP = { width: 390, height: 844 };

const PATHS = [
  "/ja",
  "/ja/journal",
  "/ja/journal/autumn-outdoor-tea-ceremony-matcha",
  "/ja/journal/chiran-fukamushi-tea-kagoshima",
  "/ja/elxea-journal",
  "/ja/playlists",
  "/ja/tea-menu",
  "/ja/account",
  "/ja/account/favorites",
  "/ja/cart",
  "/ja/subscription",
  "/ja/search",
];

const PROBE = () => {
  const out = [];

  const isHidden = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return true;
    // sr-only は 1px に潰すのが正しい姿なので対象外。
    if (cs.clip === "rect(0px, 0px, 0px, 0px)") return true;
    if (el.classList.contains("sr-only")) return true;
    return false;
  };

  const describe = (el) => {
    const cls = (el.getAttribute("class") || "").slice(0, 120);
    const slot = el.getAttribute("data-slot");
    return `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ""} .${cls}`;
  };

  const lineCount = (el) => {
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    if (!lh || Number.isNaN(lh)) return null;
    return Math.round(el.getBoundingClientRect().height / lh);
  };

  for (const row of document.querySelectorAll("*")) {
    const cs = getComputedStyle(row);
    if (cs.display !== "flex") continue;
    if (cs.flexDirection !== "row") continue;
    if (cs.flexWrap === "wrap") continue; // 折り返す行は縦積みに崩れるので対象外

    const kids = [...row.children].filter((k) => !isHidden(k));
    if (kids.length < 2) continue;

    const rowW = row.getBoundingClientRect().width;
    if (rowW < 100) continue;

    const heading = kids.find(
      (k) =>
        /^H[1-3]$/.test(k.tagName) ||
        k.classList.contains("page-title") ||
        k.querySelector?.("h1, h2, .page-title"),
    );
    if (!heading) continue;

    const others = kids.filter((k) => k !== heading);
    const stealers = others.filter((k) => {
      const s = getComputedStyle(k);
      const w = k.getBoundingClientRect().width;
      return (s.flexShrink === "0" || s.flexBasis !== "auto") && w > 40;
    });
    if (!stealers.length) continue;

    const headW = heading.getBoundingClientRect().width;
    const stolen = stealers.reduce(
      (n, k) => n + k.getBoundingClientRect().width,
      0,
    );
    const share = Math.round((headW / rowW) * 100);

    out.push({
      row: describe(row),
      rowW: Math.round(rowW),
      headTag: heading.tagName.toLowerCase(),
      headText: (heading.textContent || "").trim().slice(0, 34),
      headW: Math.round(headW),
      headShare: share,
      headLines: lineCount(heading),
      stolenW: Math.round(stolen),
      stealer: describe(stealers[0]),
      stealerText: (stealers[0].textContent || "").trim().slice(0, 28),
    });
  }

  return {
    rows: out,
    docOverflow: document.documentElement.scrollWidth - window.innerWidth,
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: SP });
let findings = 0;

for (const path of PATHS) {
  try {
    const res = await page.goto(BASE + path, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForTimeout(1500);
    if (!res || res.status() >= 400) {
      console.log(`\n### ${path}  [SKIP HTTP ${res ? res.status() : "?"}]`);
      continue;
    }
    const { rows, docOverflow } = await page.evaluate(PROBE);
    console.log(`\n### ${path}   docOverflow=${docOverflow}px`);
    if (!rows.length) {
      console.log("  [OK] 見出しを圧迫する横並びなし");
      continue;
    }
    for (const r of rows) {
      findings++;
      const flag = r.headShare < 75 ? "WARN" : "INFO";
      console.log(
        `  [${flag}] 見出しが行の ${r.headShare}% (${r.headW}/${r.rowW}px) ` +
          `${r.headLines}行 / 横取り ${r.stolenW}px\n` +
          `         head=${r.headTag} "${r.headText}"\n` +
          `         row=${r.row}\n` +
          `         stealer=${r.stealer}\n         stealerText="${r.stealerText}"`,
      );
    }
  } catch (e) {
    console.log(`\n### ${path}  [ERR] ${e.message.split("\n")[0]}`);
  }
}

console.log(`\n==== rows examined with findings: ${findings} ====`);
await browser.close();
