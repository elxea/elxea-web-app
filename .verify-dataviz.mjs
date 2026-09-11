#!/usr/bin/env node
/**
 * 統合ブランチのプレビューで dataviz 側を実証する。
 *
 *   node verify-dataviz.mjs <baseUrl> <outDir>
 *
 * 目視では「出ているが中身が空」を見逃すので、各段で数値
 * (要素数・実寸・実際の塗り色) を採って判定する。
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE = process.argv[2];
const OUT = process.argv[3] ?? "/tmp/roji-integration-dataviz";
const PRODUCTS = ["spring-sencha", "uji-gyokuro", "kaga-hojicha"];

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "[OK]  " : "[FAIL]"} ${name} — ${detail}`);
};

/** ページ全体の console error / pageerror を集める。 */
function attachConsole(page, bag) {
  page.on("console", (m) => {
    if (m.type() === "error") bag.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => bag.push(`pageerror: ${e.message}`));
}

/** 描画が始まってから測る (canvas / maplibre は遅れて塗られる)。 */
async function settle(page, ms = 3500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * 図は `useInViewOnce` / `next/dynamic` で「視界に入ってから」載る。
 * 上から順に少しずつ送って全部の図を起こしてから測る。
 */
async function revealAll(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 350));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2500);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    // maplibre は WebGL2 必須。headless は既定で GPU が無いので SwiftShader で
    // ソフトウェア実装を有効にする (検証環境の都合であって製品側の条件ではない)。
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];

  // ---- (b) 一覧のテロワール地図 -------------------------------------------
  {
    const page = await ctx.newPage();
    attachConsole(page, errors);
    await page.goto(`${BASE}/ja/tea-menu`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await revealAll(page);

    const ov = page.locator('[data-slot="terroir-overview"]');
    record("一覧にテロワール地図がある", (await ov.count()) > 0, `count=${await ov.count()}`);

    const box = await ov.first().boundingBox();
    record(
      "一覧の地図が実寸を持つ",
      !!box && box.width > 320 && box.height > 200,
      box ? `${Math.round(box.width)}x${Math.round(box.height)}px` : "no box",
    );

    // 「地図の枠は出たが中身が真っ白」を弾く。
    //
    // WebGL の canvas を drawImage で読み戻す方法は使えない: maplibre は
    // preserveDrawingBuffer:false で描くので、フレーム後に読むと必ず空が返り
    // 実際には描けていても「1 色」に見える (偽陰性)。合成後の**要素の
    // スクリーンショット**を撮り、その PNG の重さを地の複雑さの代理指標にする。
    // 単色の面はほぼ圧縮しきるので、地形が乗っているかは桁で分かれる。
    const shot = await ov.first().screenshot();
    record(
      "一覧の地図が実際に描画されている (真っ白でない)",
      shot.length > 20000,
      `element PNG=${(shot.length / 1024).toFixed(0)}KB (単色なら数 KB)`,
    );

    const pins = await page.locator('[data-slot="terroir-overview-pin"]').count();
    record("一覧の地図に産地ピンが立つ", pins > 0, `pins=${pins}`);

    await page.screenshot({ path: path.join(OUT, "01-tea-menu-list-map.png"), fullPage: true });
    await page.close();
  }

  // ---- (c) 単品詳細 3 マップ + 同カテゴリー同色 ----------------------------
  for (const slug of PRODUCTS) {
    const page = await ctx.newPage();
    attachConsole(page, errors);
    await page.goto(`${BASE}/ja/tea-menu/${slug}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    await revealAll(page);

    const slots = ["flavor-matrix", "aroma-field", "terroir-lens"];
    const found = [];
    for (const s of slots) found.push([s, await page.locator(`[data-slot="${s}"]`).count()]);
    record(
      `${slug}: 3 マップが揃う`,
      found.every(([, n]) => n > 0),
      found.map(([s, n]) => `${s}=${n}`).join(" "),
    );

    // 各図の凡例スウォッチの実際の塗り色を採る
    const colors = await page.evaluate(() => {
      const out = {};
      for (const key of ["flavor-legend", "aroma-legend", "terroir-legend"]) {
        const root = document.querySelector(`[data-slot="${key}"]`);
        if (!root) { out[key] = null; continue; }
        const sw = [...root.querySelectorAll("*")]
          .map((el) => getComputedStyle(el).backgroundColor)
          .filter((c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent");
        out[key] = [...new Set(sw)];
      }
      return out;
    });

    const present = Object.entries(colors).filter(([, v]) => v && v.length);
    const flat = [...new Set(present.flatMap(([, v]) => v))];
    record(
      `${slug}: 同カテゴリー = 1 図 1 色`,
      present.length > 0 && present.every(([, v]) => v.length === 1),
      present.map(([k, v]) => `${k}:[${v.join("|")}]`).join(" "),
    );
    record(
      `${slug}: 3 図が同じカテゴリー色で揃う`,
      flat.length === 1,
      `distinct=${flat.length} ${flat.join(" / ")}`,
    );

    await page.screenshot({ path: path.join(OUT, `02-detail-${slug}.png`), fullPage: true });
    await page.close();
  }

  // ---- (a) 記事ページのオーディオドック (見た目の記録) ---------------------
  {
    const page = await ctx.newPage();
    attachConsole(page, errors);
    await page.goto(`${BASE}/ja/journal/tsushima-oishi-farm-interview`, { waitUntil: "domcontentloaded" });
    await settle(page, 2500);
    const block = page.locator('[data-slot="audio-block"]').first();
    record("記事に AudioBlock がある", (await block.count()) > 0, `count=${await block.count()}`);
    await block.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "03-article-audio.png"), fullPage: false });
    await page.close();
  }

  // ---- (d) console error 0 ------------------------------------------------
  // 外部計測 (GTM 等) のノイズは統合の可否と無関係なので除いて数える。
  const appErrors = errors.filter(
    (e) => !/googletagmanager|gtag|analytics|sentry|favicon|ERR_BLOCKED_BY_CLIENT/i.test(e),
  );
  record(
    "console error が 0 (アプリ由来)",
    appErrors.length === 0,
    appErrors.length ? appErrors.slice(0, 5).join(" ‖ ") : `0 件 (計測系ノイズ ${errors.length - appErrors.length} 件は除外)`,
  );

  await browser.close();

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} passed`);
  console.log(`screenshots: ${OUT}`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
