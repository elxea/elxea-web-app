/**
 * 起動中の Storybook の **全 story** を 1 本ずつ開き、実際に描けているかを見る。
 * 判定は Storybook 自身のエラー表示 (body の sb-show-errordisplay /
 * sb-show-nopreview) と、ページの未捕捉例外。
 */
import { chromium } from "playwright";

const BASE = "http://localhost:6006";
const HEAVY = /^(04-visualizations|05-media|99-preview)-/;

const index = await fetch(`${BASE}/index.json`).then((r) => r.json());
const stories = Object.values(index.entries).filter((e) => e.type === "story");
console.log(`stories: ${stories.length}`);

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

const failures = [];
let done = 0;

for (const story of stories) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));

  try {
    await page.goto(`${BASE}/iframe.html?id=${story.id}&viewMode=story`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(HEAVY.test(story.id) ? 6000 : 2000);

    const state = await page.evaluate(() => {
      const cl = document.body.className;
      const root = document.getElementById("storybook-root");
      return {
        errorDisplay: cl.includes("sb-show-errordisplay"),
        noPreview: cl.includes("sb-show-nopreview"),
        errorText: (document.getElementById("error-message")?.textContent || "").slice(0, 200),
        rendered: !!root && root.innerHTML.trim().length > 0,
      };
    });

    const bad = state.errorDisplay || state.noPreview || !state.rendered || errors.length > 0;
    if (bad) failures.push({ id: story.id, ...state, errors });
  } catch (e) {
    failures.push({ id: story.id, thrown: String(e.message).slice(0, 200) });
  }
  await page.close();
  done++;
  if (done % 40 === 0) console.log(`  ...${done}/${stories.length}`);
}

await browser.close();

console.log(`\nchecked=${done} failed=${failures.length}`);
for (const f of failures) console.log(JSON.stringify(f));
process.exit(failures.length === 0 ? 0 : 1);
