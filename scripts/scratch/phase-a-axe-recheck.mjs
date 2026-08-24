
/* local-only axe runner — NOT committed, lives in /tmp */
/* eslint-disable */
import { chromium } from 'playwright';
import fs from 'node:fs';

const COOKIE_VAL = process.env.STAGING_AUTH_TOKEN;
if (!COOKIE_VAL) {
  console.error('FATAL: STAGING_AUTH_TOKEN env var required');
  process.exit(2);
}
const BASE = 'http://localhost:3000';
const AXE_PATH = '/Users/setaka/github/elxea/products/elxea-web-app/node_modules/.pnpm/axe-core@4.11.1/node_modules/axe-core/axe.min.js';
const axeSource = fs.readFileSync(AXE_PATH, 'utf8');

const targets = [
  { name: 'search-empty', url: '/ja/search' },
  { name: 'search-zero', url: '/ja/search?q=__no__hit__zzz' },
  { name: 'top', url: '/ja' },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const summary = [];
  for (const t of targets) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    await ctx.addCookies([{
      name: 'site_auth',
      value: COOKIE_VAL,
      domain: 'localhost',
      path: '/',
    }]);
    const page = await ctx.newPage();
    const url = BASE + t.url;
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (page.url().includes('/password')) {
      console.error(`Password gate not bypassed for ${url}`);
      summary.push({ name: t.name, error: 'password gate', violations: -1 });
      await ctx.close();
      continue;
    }
    await page.waitForTimeout(500);
    await page.evaluate(axeSource);
    const axeResult = await page.evaluate(async () => {
      return await window.axe.run(document, {
        runOnly: { type: 'rule', values: ['color-contrast'] },
        resultTypes: ['violations'],
      });
    });
    const v = axeResult.violations || [];
    const total = v.reduce((s, x) => s + x.nodes.length, 0);
    console.log(`[${t.name}] color-contrast violations: rules=${v.length} nodes=${total}`);
    if (v.length) {
      for (const vio of v) {
        for (const n of vio.nodes.slice(0, 5)) {
          // attempt to extract any color info from failureSummary
          console.log(`   - ${n.target?.join(', ')}: ${(n.failureSummary || '').slice(0, 200).replace(/\n/g,' ')}`);
        }
      }
    }
    summary.push({ name: t.name, status: resp?.status(), rules: v.length, nodes: total });
    await ctx.close();
  }
  await browser.close();
  console.log('\n=== SUMMARY ===');
  for (const s of summary) console.log(JSON.stringify(s));
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
