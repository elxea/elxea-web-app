// Wave 6 before/after visual evidence.
// "before" is produced by re-injecting the OLD --color-card (#d5d3c0 = oklch(0.863 0.026 102.0))
// at runtime, so both shots come from the identical DOM/build.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";
const ARTICLE = process.env.ARTICLE ?? "/ja/journal/tea-culture-around-the-world";
const OUT = process.env.OUT ?? "/tmp";
const OLD_CARD = "oklch(0.863 0.026 102.0)";

const browser = await chromium.launch();

for (const mode of ["before", "after"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE + ARTICLE, { waitUntil: "networkidle", timeout: 60000 });
  if (mode === "before") {
    await page.addStyleTag({ content: `:root, html { --color-card: ${OLD_CARD} !important; }` });
  }
  await page.waitForTimeout(600);

  // 1) bookmark: default (real) + active (probe) side by side
  await page.evaluate(() => {
    const bm = document.querySelector('button[data-state]');
    if (!bm) return;
    const probe = document.createElement("button");
    probe.textContent = "保存済み (active)";
    probe.className =
      "h-11 gap-2 rounded-md border px-4 py-3 text-sm font-normal border-foreground bg-secondary text-foreground inline-flex items-center";
    bm.parentElement.appendChild(probe);
  });
  const header = page.locator("article header").first();
  await header.screenshot({ path: `${OUT}/w6-bookmark-${mode}.png` });

  // 2) modal footer with the outline pill held down (:active)
  const row = page.locator('[data-slot="reading-row"]').first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.waitForSelector('[data-slot="journal-modal-body"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const footer = page.locator('[data-slot="journal-modal-body"] + div');
  const pill = footer.locator("button, a").first();
  const box = await pill.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  const content = page.locator('[data-slot="journal-modal-body"]').locator("xpath=..");
  await content.screenshot({ path: `${OUT}/w6-modal-${mode}.png` });
  await page.mouse.up();
  await page.close();
}

await browser.close();
console.log("saved to", OUT);
