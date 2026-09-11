/**
 * 起動中の Storybook から story を 1 本ずつ開き、実描画のスクリーンショットを
 * 撮って console の異常を集める確認用スクリプト。
 *
 * CI には載せない (Chromatic が視覚回帰の正本)。ここが答えるのは
 * 「dataviz / audio の story が **実際に描けているか**」で、
 * とくに maplibre (WebGL) と Canvas の図は静的解析では分からないため
 * 実ブラウザで 1 度描かせて目で確かめる必要がある。
 *
 * 使い方:
 *   pnpm design-catalog            # 別ターミナルで起動しておく
 *   node scripts/storybook-story-shots.mjs --out <dir> [--filter <正規表現>]
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const BASE = arg("base", "http://localhost:6006");
const OUT = path.resolve(arg("out", "./.storybook-shots"));
const FILTER = new RegExp(arg("filter", "^(viz|audio)-"));
/** 図が落ち着くまでの待ち。Canvas の初期アニメと DEM タイルの到着を含む。 */
const SETTLE_MS = Number(arg("settle", "6000"));

/**
 * 撮る前に 1 度押す story と、押す対象。
 * 音のバーは「音源が選ばれている」ときだけ出るので、押さずに撮ると
 * 何も写らない (= 部品が動いている証拠にならない)。
 */
const CLICK_BEFORE_SHOT = {
  "audio-audiodock--playable": '[data-slot="track-row"] button',
  "audio-audiodock--precomputed-waveform": '[data-slot="track-row"] button',
  "audio-audiodock--synthesized-waveform": '[data-slot="track-row"] button',
  "audio-audiodock--source-error": '[data-slot="track-row"] button',
  // dock 側にも button が居る (音源未選択でも DOM には在る) ので、
  // 位置ではなく文言で指す。
  "audio-audiodock--expanded-panel": "text=再生してプレイヤーを開く",
};

const index = await fetch(`${BASE}/index.json`).then((r) => r.json());
const stories = Object.values(index.entries).filter(
  (e) => e.type === "story" && FILTER.test(e.id)
);

await mkdir(OUT, { recursive: true });

/**
 * 既定は headless。ただし **maplibre の story は headless では描けない** —
 * 近年の Chromium headless は WebGL2 を既定で持たず、maplibre-gl が
 * `GPUInitializationError: WebGL2 is required` で落ちる。地図の絵を実際に
 * 確かめるときは `--headed` で実 GPU の Chrome を使う。
 * `--swiftshader` は headless のまま WebGL2 を有効にする逃げ道 (絵は出るが
 * ソフトウェア描画なので色味の最終確認には使わない)。
 */
const headed = args.includes("--headed");
const swiftshader = args.includes("--swiftshader");

const browser = await chromium.launch({
  headless: !headed,
  args: swiftshader
    ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : [],
});
const results = [];

for (const story of stories) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

  try {
    // `networkidle` は使わない。story が外部の音源・地形タイルを引き続けるものが
    // あり、待っても静まらない (待ち切れずに落ちるだけで、絵とは無関係)。
    await page.goto(`${BASE}/iframe.html?id=${story.id}&viewMode=story`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => (document.querySelector("#storybook-root")?.childElementCount ?? 0) > 0,
      undefined,
      { timeout: 60_000 }
    );
    // 図は画面に入るまで render しない (`useInViewOnce`)。並べる story は
    // 下の方が空のまま写るので、一度下まで送ってから頭に戻す。
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.8;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(SETTLE_MS);

    const clickTarget = CLICK_BEFORE_SHOT[story.id];
    if (clickTarget) {
      await page.locator(clickTarget).first().click({ timeout: 10_000 });
      await page.waitForTimeout(4000);
    }

    // 何が描けたかを機械的に残す。canvas が 0 枚なら図が出ていない。
    const drawn = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll("canvas")];
      return {
        canvasCount: canvases.length,
        canvasSizes: canvases.map((c) => `${c.width}x${c.height}`),
        svgCount: document.querySelectorAll("svg").length,
        webgl: canvases.some((c) => {
          try {
            return Boolean(
              c.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
                c.getContext("webgl", { failIfMajorPerformanceCaveat: false })
            );
          } catch {
            return false;
          }
        }),
        audioBarHeight:
          document.documentElement.style.getPropertyValue("--audio-bar-h") || null,
        text: (document.body.innerText || "").slice(0, 200),
      };
    });

    const file = path.join(OUT, `${story.id}.png`);
    await page.screenshot({ path: file, fullPage: true });
    results.push({ id: story.id, title: story.title, name: story.name, file, drawn, problems });
    console.log(
      `[OK] ${story.id} canvas=${drawn.canvasCount} svg=${drawn.svgCount} problems=${problems.length}`
    );
  } catch (error) {
    results.push({ id: story.id, title: story.title, name: story.name, error: String(error), problems });
    console.log(`[FAIL] ${story.id} ${error}`);
  } finally {
    await context.close();
  }
}

await browser.close();
await writeFile(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));

const failed = results.filter((r) => r.error);
console.log(`\n${results.length} stories / ${failed.length} failed`);
if (failed.length > 0) process.exitCode = 1;
