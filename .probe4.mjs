import { chromium } from "playwright";
const BASE = "http://localhost:6006";
const ids = ["02-elements-carousel--default","02-elements-sheet--right","02-elements-sidebar--default","02-elements-slider--default"];
const b = await chromium.launch({ headless: true, args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport:{width:1280,height:800} });
for (const id of ids) {
  const p = await ctx.newPage();
  const errs=[]; p.on("pageerror",e=>errs.push(e.message.slice(0,300)));
  await p.goto(`${BASE}/iframe.html?id=${id}&viewMode=story`, {waitUntil:"domcontentloaded"});
  await p.waitForTimeout(6000);
  const r = await p.evaluate(()=>({
    bodyClass: document.body.className,
    rootLen: (document.getElementById("storybook-root")?.innerHTML||"").length,
    docsRootLen: (document.getElementById("storybook-docs")?.innerHTML||"").length,
    bodyTextLen: document.body.innerText.trim().length,
    bodyChildren: [...document.body.children].map(c=>c.id||c.tagName),
  }));
  console.log(id, JSON.stringify(r), "errors:", JSON.stringify(errs));
  await p.close();
}
await b.close();
