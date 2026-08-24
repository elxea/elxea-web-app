// Wave 6: B3 (bookmark active surface) + B2 (audio block surface) runtime probes.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";
const PATHS = (process.env.PATHS ?? "").split(",").filter(Boolean);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const out = {};

for (const p of PATHS) {
  await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(800);

  out[p] = await page.evaluate(() => {
    const res = {};
    const bm = document.querySelector(
      'button[data-state="logged-out"], button[data-state="default"], button[data-state="active"], button[data-state="loading"]'
    );
    if (bm) {
      const cs = getComputedStyle(bm);
      res.bookmark = {
        state: bm.getAttribute("data-state"),
        bg: cs.backgroundColor,
        border: cs.borderTopColor,
        color: cs.color,
      };
      // Sibling probe carrying the real "active" (bookmarked) class string.
      const probe = document.createElement("button");
      probe.className =
        "h-11 gap-2 rounded-md border px-4 py-3 text-sm font-normal border-foreground bg-secondary text-foreground";
      bm.parentElement.appendChild(probe);
      const pcs = getComputedStyle(probe);
      res.bookmark_active_probe = {
        bg: pcs.backgroundColor,
        border: pcs.borderTopColor,
        color: pcs.color,
      };
      probe.remove();
    }

    const blocks = [...document.querySelectorAll('[data-slot="audio-block"]')];
    res.audio_blocks = blocks.map((b) => {
      const link = b.querySelector('a[href*="soundcloud"]');
      return {
        variant: b.getAttribute("data-variant"),
        section_bg: getComputedStyle(b).backgroundColor,
        section_border: getComputedStyle(b).borderTopColor,
        has_soundcloud_link: !!link,
        link_rest_bg: link ? getComputedStyle(link).backgroundColor : null,
      };
    });
    return res;
  });
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
