import { chromium } from '@playwright/test';
const b = await chromium.launch();
for (const w of [390, 768]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, locale: 'ja-JP' });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3000/ja', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  const info = await p.locator('h1').evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { fontSize: cs.fontSize, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, w: r.width, h: r.height, lineHeight: cs.lineHeight, font: cs.font };
  });
  const vis = await p.locator('h1').isVisible();
  console.log(`W=${w} isVisible=${vis}`, JSON.stringify(info));
  await ctx.close();
}
await b.close();
