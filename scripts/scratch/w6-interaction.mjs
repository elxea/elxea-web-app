// Wave 6 runtime interaction verification (B1 modal footer press / B3 bookmark active).
// Throwaway (scripts/scratch is gitignored).
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";
const ARTICLE = process.env.ARTICLE ?? "/ja/journal/tea-culture-around-the-world";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const out = {};

await page.goto(BASE + ARTICLE, { waitUntil: "networkidle", timeout: 60000 });

// --- B3: BookmarkButton default vs forced "active" (bookmarked) classes ---
const bookmark = page.locator('button:has(svg.lucide-bookmark)').first();
if (await bookmark.count()) {
  out.bookmark_default = await bookmark.evaluate((el) => {
    const cs = getComputedStyle(el);
    const p = getComputedStyle(el.closest("header") ?? el.parentElement);
    return {
      bg: cs.backgroundColor,
      color: cs.color,
      border: cs.borderTopColor,
      state: el.getAttribute("data-state"),
      parentBg: p.backgroundColor,
    };
  });
  // Force the "active" (bookmarked) variant classes on the very same node,
  // so the browser resolves them in the real cascade position.
  out.bookmark_active_forced = await bookmark.evaluate((el) => {
    const orig = el.className;
    el.className = orig
      .replace(/border-border/g, "border-foreground")
      .replace(/bg-card/g, "bg-secondary")
      .replace(/text-foreground/g, "text-foreground");
    const cs = getComputedStyle(el);
    const v = { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor };
    el.className = orig;
    return v;
  });
}

// --- B1: modal footer + outline pill :active ---
const row = page.locator('[data-slot="related-readings"] li button, [data-slot="related-readings"] li a').first();
if (await row.count()) {
  await row.click();
  await page.waitForSelector('[data-slot="journal-modal-body"]', { timeout: 10000 });
  const body = page.locator('[data-slot="journal-modal-body"]');
  const footer = page.locator('[data-slot="journal-modal-body"] + div');

  out.modal_body_bg = await body.evaluate((el) => getComputedStyle(el).backgroundColor);
  out.modal_content_bg = await body.evaluate(
    (el) => getComputedStyle(el.parentElement).backgroundColor
  );
  out.modal_footer_bg = await footer.evaluate((el) => getComputedStyle(el).backgroundColor);

  const pill = footer.locator("button, a").first();
  out.pill_rest_bg = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);

  const box = await pill.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    out.pill_hover_bg = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.down();
    await page.waitForTimeout(250); // let the 200ms color transition land
    out.pill_active_bg = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
    out.pill_active_footer_bg = await footer.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.up();
  }
}

// --- B2: SoundCloud link on the audio block (parent surface check) ---
const sc = page.locator('[data-slot="audio-block"] a[href*="soundcloud"]').first();
if (await sc.count()) {
  out.soundcloud = await sc.evaluate((el) => {
    const cs = getComputedStyle(el);
    const sec = el.closest('[data-slot="audio-block"]');
    return {
      variant: sec?.getAttribute("data-variant"),
      rest_bg: cs.backgroundColor,
      section_bg: sec ? getComputedStyle(sec).backgroundColor : null,
    };
  });
  const b = await sc.boundingBox();
  if (b) {
    await sc.scrollIntoViewIfNeeded();
    const b2 = await sc.boundingBox();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.waitForTimeout(250);
    out.soundcloud.hover_bg = await sc.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.down();
    await page.waitForTimeout(250);
    out.soundcloud.active_bg = await sc.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.mouse.up();
  }
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
