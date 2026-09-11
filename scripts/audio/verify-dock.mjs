#!/usr/bin/env node
/**
 * 下部固定バー / 遷移をまたぐ再生 / 波形シーク をブラウザで実証する。
 *
 * 目視スクリーンショットだけでは「見えているが動いていない」を見逃すので、
 * 各段で **数値** (経過秒・要素の位置・getComputedStyle) を採って判定する。
 *
 *   node scripts/audio/verify-dock.mjs <baseUrl> <outDir>
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE = process.argv[2] ?? "http://localhost:3211";
const OUT = process.argv[3] ?? "/tmp/roji-audio";
const ARTICLE = "/ja/journal/tsushima-oishi-farm-interview";

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "[OK]  " : "[FAIL]"} ${name} — ${detail}`);
}

/**
 * 進入アニメが終わり、座標が動かなくなってから境界を返す。
 *
 * 動きが付く前は「出た瞬間 = 最終位置」だったので測ってすぐ掴めたが、
 * 展開パネルは下から 300ms かけて上がってくるようになった。その最中に
 * `boundingBox()` を採ると画面外に近い座標 (実測 y=1089 / 静止後 y=362) を
 * 掴んでしまい、そこへドラッグしても波形に当たらずシークが空振りする。
 * 製品の不具合ではなく測り方の問題なので、待ちを検証側に入れる。
 *
 * 固定の `waitForTimeout` にしないのは、時間を伸ばしても「たまたま間に合った」
 * だけで根拠にならないため。(1) Web Animations API で当該要素のアニメーション
 * 完了を待ち、(2) それでも残るレイアウトの揺れに備えて同じ座標が続けて取れる
 * ことまで確かめる、の2段で待つ。
 */
async function waitForStableBox(locator, { timeout = 10000, settleSamples = 3 } = {}) {
  // (1) この要素に掛かっているアニメーションが終わるまで待つ。
  //     subtree を見ないのは、中の読み込み中スピナー (無限ループ) を拾うと
  //     永遠に終わらないため。
  await locator
    .evaluate(
      (el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
      undefined,
      { timeout }
    )
    .catch(() => undefined);

  // (2) 同じ座標が settleSamples 回続けて取れたら静止とみなす。
  const deadline = Date.now() + timeout;
  let previous = null;
  let stable = 0;

  while (Date.now() < deadline) {
    const box = await locator.boundingBox();
    const settled =
      box &&
      previous &&
      Math.abs(box.x - previous.x) < 0.5 &&
      Math.abs(box.y - previous.y) < 0.5 &&
      Math.abs(box.width - previous.width) < 0.5 &&
      Math.abs(box.height - previous.height) < 0.5;

    if (settled) {
      stable += 1;
      if (stable >= settleSamples) return box;
    } else {
      stable = 0;
    }
    previous = box;
    await locator.page().waitForTimeout(50);
  }

  throw new Error(`要素の位置が ${timeout}ms 以内に静止しなかった`);
}

/** バーに出ている `0:12 / 3:45` の経過側を秒に直す。 */
async function elapsedSeconds(page) {
  const text = await page
    .locator('[data-slot="audio-dock-bar"] span:has-text("/")')
    .first()
    .textContent();
  const m = /(\d+):(\d{2})\s*\//.exec(text ?? "");
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: [
      // クリックは実ジェスチャだが、CI 相当の環境で確実に鳴らすため明示する。
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio", // 音は出さなくても currentTime は進む
    ],
  });
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));

  // ---------- 1. 記事ページで再生を開始する ----------
  await page.goto(BASE + ARTICLE, { waitUntil: "domcontentloaded" });
  // 記事ページには `[data-slot="audio-block"]` が2個あり、うち1個は hidden
  // (レイアウト都合の控え)。素で掴むと strict mode 違反で初回だけ落ちるので、
  // 見えている方に限定する。
  const block = page.locator('[data-slot="audio-block"]').filter({ visible: true }).first();
  await block.waitFor({ state: "visible", timeout: 30000 });
  record("記事に AudioBlock がある", true, await block.getAttribute("data-variant"));

  // 再生前はバーが出ていないこと (常時表示ではなく「音源が選ばれたら常時」)。
  const barBefore = await page.locator('[data-slot="audio-dock-bar"]').count();
  record("再生前は下部バーが無い", barBefore === 0, `count=${barBefore}`);

  const bar = page.locator('[data-slot="audio-dock-bar"]');
  const playButton = block.locator('[data-slot="audio-player"] button').first();

  // ハイドレーションが済む前に押すと、見た目は押せてもハンドラがまだ付いて
  // おらず何も起きない (Playwright の actionability チェックは「押せる状態に
  // 見えるか」しか見ないので、この空振りは検出できない)。バーが出るまで
  // 押し直す。バーは `current` が入った時点で即描画されるので、出ない =
  // クリックが届いていない、と判断してよい。
  await page.waitForLoadState("load");
  let barAppeared = false;
  let clicks = 0;
  for (let attempt = 1; attempt <= 5 && !barAppeared; attempt += 1) {
    await playButton.click();
    clicks = attempt;
    barAppeared = await bar
      .waitFor({ state: "visible", timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (!barAppeared) {
      console.log(`  [retry] 再生ボタンのクリックが届かず (${attempt} 回目) — 押し直す`);
      await page.waitForTimeout(1000);
    }
  }
  record("再生開始で下部バーが出る", barAppeared, `data-slot=audio-dock-bar visible (クリック ${clicks} 回)`);
  if (!barAppeared) throw new Error("再生が開始できず、以降の検証が成立しない");

  // ---------- 2. 実際に音が進んでいるか (数値で確認) ----------
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-slot="audio-dock-bar"]');
      return el && /\d+:\d{2}\s*\/\s*\d+:\d{2}/.test(el.textContent ?? "");
    },
    { timeout: 60000 }
  );
  const t1 = await elapsedSeconds(page);
  await page.waitForTimeout(4000);
  const t2 = await elapsedSeconds(page);
  record("再生位置が進む", t2 !== null && t1 !== null && t2 > t1, `${t1}s -> ${t2}s`);

  await page.screenshot({ path: path.join(OUT, "01-bar-on-article.png"), fullPage: false });

  // ---------- 3. バーが「常時」出るか (スクロールしても消えない) ----------
  // 旧 MiniPlayer は本体が画面内にあるとバーを消していた。最上部へ戻して確認する。
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const visibleAtTop = await bar.isVisible();
  // バーも下から上がってくるようになったので、下端に着いてから測る。
  const boxTop = await waitForStableBox(bar);
  const vh = page.viewportSize().height;
  record(
    "最上部でもバーが残る (スクロール連動の廃止)",
    visibleAtTop,
    `visible=${visibleAtTop} bottom=${boxTop ? Math.round(boxTop.y + boxTop.height) : "?"} viewportH=${vh}`
  );
  record(
    "バーが画面下端に固定されている",
    Boolean(boxTop) && Math.abs(boxTop.y + boxTop.height - vh) <= 1,
    `barBottom=${boxTop ? Math.round(boxTop.y + boxTop.height) : "?"} vs vh=${vh}`
  );

  // ---------- 3b. 下端を共有する他の常駐 UI と重なっていないか ----------
  // Cookie 同意バーは z-50 で音声バー (1020) より後ろ。重ねると同意ボタンが
  // 押せなくなるので、退いていることを座標で確かめる。
  const cookieCoex = await page.evaluate(() => {
    const bar = document.querySelector('[data-slot="audio-dock-bar"]');
    // Cookie バーは data-slot を持たないので、固定要素から絞り込む。
    const cookie = [...document.querySelectorAll("div.fixed")].find(
      (el) => el !== bar && /Cookie|cookie/.test(el.textContent ?? "")
    );
    if (!bar || !cookie) return null;
    const b = bar.getBoundingClientRect();
    const c = cookie.getBoundingClientRect();
    return { audioTop: Math.round(b.top), cookieBottom: Math.round(c.bottom) };
  });
  if (cookieCoex) {
    record(
      "Cookie 同意バーが音声バーの上へ退く",
      cookieCoex.cookieBottom <= cookieCoex.audioTop + 1,
      `cookieBottom=${cookieCoex.cookieBottom} <= audioTop=${cookieCoex.audioTop}`
    );
  } else {
    record("Cookie 同意バーの共存", true, "[SKIP] 同意済みで非表示");
  }

  // モバイルのチャット起動ボタンがバーの裏に隠れていないか。
  const fabCoex = await page.evaluate(() => {
    const bar = document.querySelector('[data-slot="audio-dock-bar"]');
    const fab = document.querySelector('[data-slot="chat-launcher"]');
    if (!bar || !fab) return null;
    const b = bar.getBoundingClientRect();
    const f = fab.getBoundingClientRect();
    return { audioTop: Math.round(b.top), fabBottom: Math.round(f.bottom) };
  });
  if (fabCoex) {
    record(
      "チャット起動ボタンが音声バーに隠れない",
      fabCoex.fabBottom <= fabCoex.audioTop + 1,
      `fabBottom=${fabCoex.fabBottom} <= audioTop=${fabCoex.audioTop}`
    );
  } else {
    record("チャット起動ボタンの共存", true, "[SKIP] 非表示");
  }

  // ---------- 4. ページ遷移をまたいで鳴り続けるか ----------
  const before = await elapsedSeconds(page);
  // SPA 遷移。フルリロードだと音が切れて当然なので、必ずクライアント遷移で行う。
  await page.evaluate(() => {
    const link = document.querySelector('a[href*="/journal"]');
    if (link) link.click();
  });
  await page.waitForTimeout(4000);
  const urlAfter = page.url();
  const barAfter = await bar.isVisible().catch(() => false);
  const after = await elapsedSeconds(page);
  record(
    "遷移後もバーが残る",
    barAfter,
    `url=${urlAfter.replace(BASE, "")} barVisible=${barAfter}`
  );
  record(
    "遷移をまたいで再生が継続する",
    after !== null && before !== null && after > before,
    `${before}s -> ${after}s (遷移先 ${urlAfter.replace(BASE, "")})`
  );
  await page.screenshot({ path: path.join(OUT, "02-bar-after-navigation.png") });

  // ---------- 5. 展開して波形シーク ----------
  await bar.getByRole("button", { name: "プレイヤーを開く" }).click();
  const panel = page.locator('[data-slot="audio-dock-panel"]');
  await panel.waitFor({ state: "visible", timeout: 15000 });
  // パネルが上がりきってから中身を測る。ここを待たずに測ると、後段の
  // 波形ドラッグが「まだ画面外にある座標」を掴んで空振りする。
  await waitForStableBox(panel);
  const wave = panel.locator('[data-slot="audio-waveform"]');
  await wave.waitFor({ state: "visible", timeout: 15000 });

  const waveBox = await waitForStableBox(wave);
  record(
    "展開パネルに波形が出る",
    Boolean(waveBox),
    `waveform ${Math.round(waveBox.width)}x${Math.round(waveBox.height)}px`
  );

  // 波形の棒が本数ぶん描かれているか (事前計算 peaks が効いているか)。
  const barCount = await wave.locator("span").count();
  record("波形が peaks 本数ぶん描かれている", barCount >= 200, `bars=${barCount}`);

  // 誤操作対策: touch-action / overscroll-behavior が実際に効いているか。
  const styles = await wave.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      touchAction: s.touchAction,
      overscrollBehavior: s.overscrollBehavior,
      userSelect: s.userSelect || s.webkitUserSelect,
      minHeight: s.minHeight,
    };
  });
  record(
    "波形が touch-action:none (指で擦ってもページが動かない)",
    styles.touchAction === "none",
    `touch-action=${styles.touchAction}`
  );
  record(
    "波形が overscroll-behavior:contain",
    styles.overscrollBehavior === "contain",
    `overscroll-behavior=${styles.overscrollBehavior}`
  );
  record(
    "シークのタップ域が 44px 以上",
    waveBox.height >= 44,
    `height=${Math.round(waveBox.height)}px (min-height=${styles.minHeight})`
  );

  await page.screenshot({ path: path.join(OUT, "03-expanded-waveform.png") });

  // ---------- 6. 波形をドラッグして再生位置が飛ぶか ----------
  const seekBefore = await panel
    .locator("span.tabular-nums")
    .first()
    .textContent();

  // 擦っている間にページが動かないこと (要件 4) を座標で確かめる。
  const scrollBefore = await page.evaluate(() => window.scrollY);

  // 左から 80% の位置まで擦る。押す→動かす→離す、を実ポインタで行う。
  const y = waveBox.y + waveBox.height / 2;
  await page.mouse.move(waveBox.x + waveBox.width * 0.1, y);
  await page.mouse.down();
  await page.mouse.move(waveBox.x + waveBox.width * 0.5, y, { steps: 10 });
  // 縦にもぶらす。指は真横には動かないので、上下にぶれても掴んだままで
  // あること (setPointerCapture が効いていること) をここで確かめる。
  await page.mouse.move(waveBox.x + waveBox.width * 0.7, y - 40, { steps: 5 });
  await page.mouse.move(waveBox.x + waveBox.width * 0.8, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1500);

  const scrollAfter = await page.evaluate(() => window.scrollY);
  record(
    "波形を擦ってもページがスクロールしない",
    scrollBefore === scrollAfter,
    `scrollY ${scrollBefore} -> ${scrollAfter}`
  );

  const seekAfter = await panel.locator("span.tabular-nums").first().textContent();
  const totalText = await panel.locator("span.tabular-nums").nth(1).textContent();

  const toSec = (t) => {
    const m = /(\d+):(\d{2})/.exec(t ?? "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const secAfter = toSec(seekAfter);
  const secTotal = toSec(totalText);
  const ratio = secAfter !== null && secTotal ? secAfter / secTotal : null;

  record(
    "波形ドラッグで再生位置が動く",
    secAfter !== null && toSec(seekBefore) !== null && secAfter > toSec(seekBefore),
    `${seekBefore} -> ${seekAfter} (総尺 ${totalText})`
  );
  record(
    "掴んだ位置 (80%) に飛んでいる",
    ratio !== null && Math.abs(ratio - 0.8) < 0.1,
    `ratio=${ratio === null ? "?" : ratio.toFixed(3)} (期待 0.80 ± 0.10)`
  );

  await page.screenshot({ path: path.join(OUT, "04-after-waveform-seek.png") });

  // ---------- 7. ChatBar との共存 (PC 幅) ----------
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  // 閉じるときも退出アニメを最後まで見せてから DOM を外す作りなので、
  // 固定待ちではなくパネルが実際に消えるまで待つ。
  await panel.waitFor({ state: "detached", timeout: 10000 }).catch(() => undefined);
  await waitForStableBox(bar);

  const coex = await page.evaluate(() => {
    const bar = document.querySelector('[data-slot="audio-dock-bar"]');
    const chat = document.querySelector('[data-slot="chat-bar-desktop"]');
    if (!bar || !chat) return null;
    const b = bar.getBoundingClientRect();
    const c = chat.getBoundingClientRect();
    return {
      audioTop: Math.round(b.top),
      audioBottom: Math.round(b.bottom),
      chatBottom: Math.round(c.bottom),
      audioVar: getComputedStyle(document.documentElement).getPropertyValue("--audio-bar-h").trim(),
      audioZ: getComputedStyle(bar).zIndex,
      chatZ: getComputedStyle(chat).zIndex,
    };
  });

  if (coex) {
    record(
      "ChatBar が音声バーの分だけ上へ退く",
      coex.chatBottom <= coex.audioTop + 1,
      `chatBottom=${coex.chatBottom} <= audioTop=${coex.audioTop} (--audio-bar-h=${coex.audioVar})`
    );
    record(
      "音声バーが ChatBar より前面",
      Number(coex.audioZ) > Number(coex.chatZ),
      `audio z=${coex.audioZ} > chat z=${coex.chatZ}`
    );
  } else {
    record("ChatBar 共存の実測", false, "ChatBar が見つからない");
  }

  await page.screenshot({ path: path.join(OUT, "05-pc-coexist-chatbar.png") });

  await writeFile(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
