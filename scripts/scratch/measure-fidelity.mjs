import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3100";
const routes = {
  collections: "/ja/collections",
  journal: "/ja/elxea-journal",
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

// canvas-based reliable hex resolver injected per page
const resolveScript = `
  window.__hex = (colorStr) => {
    const c = document.createElement('canvas'); c.width = 1; c.height = 1;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillStyle = colorStr;
    g.fillRect(0,0,1,1); const d = g.getImageData(0,0,1,1).data;
    const h = (n) => n.toString(16).padStart(2,'0');
    return '#' + h(d[0]) + h(d[1]) + h(d[2]);
  };
`;

async function measureCommon(url) {
  await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(resolveScript);
  return await page.evaluate(() => {
    const cs = (el) => el ? getComputedStyle(el) : null;
    const body = cs(document.body);
    const header = cs(document.querySelector("header"));
    const footer = cs(document.querySelector("footer"));
    const h1el = document.querySelector("main h1, h1");
    const h1 = cs(h1el);
    // nearest .section-wide container
    const sw = document.querySelector(".section-wide");
    const swc = cs(sw);
    const grid = document.querySelector("main .grid");
    const gc = cs(grid);
    return {
      bodyBg: window.__hex(body.backgroundColor),
      headerBg: header ? window.__hex(header.backgroundColor) : null,
      footerBg: footer ? window.__hex(footer.backgroundColor) : null,
      h1Text: h1el ? h1el.textContent.trim().slice(0, 20) : null,
      h1Size: h1 ? h1.fontSize : null,
      h1Weight: h1 ? h1.fontWeight : null,
      h1Color: h1 ? window.__hex(h1.color) : null,
      sectionPadTop: swc ? swc.paddingTop : null,
      sectionPadLeft: swc ? swc.paddingLeft : null,
      gridColGap: gc ? gc.columnGap : null,
      gridRowGap: gc ? gc.rowGap : null,
    };
  });
}

const out = {};
for (const [k, url] of Object.entries(routes)) {
  try { out[k] = await measureCommon(url); }
  catch (e) { out[k] = { error: String(e).slice(0, 200) }; }
}

// detail page: grab first collection handle from collections grid
try {
  await page.goto(BASE + "/ja/collections", { waitUntil: "networkidle", timeout: 60000 });
  const href = await page.evaluate(() => {
    const a = document.querySelector('a[href*="/collections/"]');
    return a ? a.getAttribute("href") : null;
  });
  if (href) { out.detail = await measureCommon(href.replace(/^\/[a-z]{2}/, "/ja")); out.detailHref = href; }
  else out.detail = { note: "no collection link found (empty data)" };
} catch (e) { out.detail = { error: String(e).slice(0, 200) }; }

console.log(JSON.stringify(out, null, 2));
await browser.close();
