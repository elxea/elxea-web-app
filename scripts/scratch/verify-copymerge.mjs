import { chromium } from 'playwright';

const SHOT = '/tmp/circl-boss-elxea-webapp-20260702/scratchpad';
const b = await chromium.launch();
const results = {};

async function h1Size(path) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1024 } });
  await p.goto('http://localhost:3200' + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const info = await p.evaluate(() => {
    const el = document.querySelector('h1.hero-display') || document.querySelector('h1');
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    return { found: true, fontSize: cs.fontSize, text: (el.textContent || '').slice(0, 30) };
  });
  await p.close();
  return info;
}

async function shoot(path, name) {
  const p = await b.newPage({ viewport: { width: 1440, height: 1024 } });
  await p.goto('http://localhost:3200' + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.evaluate(() => new Promise((r) => { window.scrollTo(0, document.body.scrollHeight); setTimeout(r, 1000); }));
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(600);
  const out = `${SHOT}/shot-${name}-pc1440.png`;
  await p.screenshot({ path: out, fullPage: true });
  await p.close();
  return out;
}

results.about_h1 = await h1Size('/ja/about');
results.subscription_h1 = await h1Size('/ja/subscription');
results.shot_top = await shoot('/ja', 'top');
results.shot_about = await shoot('/ja/about', 'about');
results.shot_subscription = await shoot('/ja/subscription', 'subscription-lp');

await b.close();
console.log(JSON.stringify(results, null, 2));
