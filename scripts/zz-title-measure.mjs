import { chromium } from "playwright";
const URL = "http://localhost:3241/ja/journal/autumn-outdoor-tea-ceremony-matcha";
const b = await chromium.launch();
for (const vp of [{width:390,height:844,name:"SP 390"},{width:1440,height:900,name:"PC 1440"}]) {
  const p = await b.newPage({ viewport: { width: vp.width, height: vp.height } });
  await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const h1 = document.querySelector("article h1");
    const btn = document.querySelector('button[data-slot="favorite-toggle"]');
    const row = h1?.parentElement;
    const cs = getComputedStyle(h1);
    const lh = parseFloat(cs.lineHeight);
    const hr = h1.getBoundingClientRect(), br = btn.getBoundingClientRect(), rr = row.getBoundingClientRect();
    return {
      flexDirection: getComputedStyle(row).flexDirection,
      rowW: Math.round(rr.width),
      h1W: Math.round(hr.width), h1Share: Math.round(hr.width/rr.width*100),
      h1Lines: Math.round(hr.height/lh), h1FontSize: cs.fontSize,
      btnW: Math.round(br.width),
      btnBelowTitle: Math.round(br.top - (hr.top + hr.height)),
    };
  });
  console.log(vp.name, JSON.stringify(r));
  await p.close();
}
await b.close();
