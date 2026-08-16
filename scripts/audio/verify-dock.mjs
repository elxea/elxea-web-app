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
  const block = page.locator('[data-slot="audio-block"]');
  await block.waitFor({ state: "visible", timeout: 30000 });
  record("記事に AudioBlock がある", true, await block.getAttribute("data-variant"));

  // 再生前はバーが出ていないこと (常時表示ではなく「音源が選ばれたら常時」)。
  const barBefore = await page.locator('[data-slot="audio-dock-bar"]').count();
  record("再生前は下部バーが無い", barBefore === 0, `count=${barBefore}`);

  await block.locator('[data-slot="audio-player"] button').first().click();

  const bar = page.locator('[data-slot="audio-dock-bar"]');
  await bar.waitFor({ state: "visible", timeout: 30000 });
  record("再生開始で下部バーが出る", true, "data-slot=audio-dock-bar visible");

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
  const boxTop = await bar.boundingBox();
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
  const wave = panel.locator('[data-slot="audio-waveform"]');
  await wave.waitFor({ state: "visible", timeout: 15000 });

  const waveBox = await wave.boundingBox();
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
  await page.waitForTimeout(500);

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
