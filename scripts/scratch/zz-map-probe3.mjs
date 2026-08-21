import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:3300";
const pw = (fs.readFileSync("/Users/setaka/github/elxea/products/elxea-web-app/.env.local","utf8")
  .split("\n").find((l)=>l.startsWith("SITE_PASSWORD="))||"").split("=").slice(1).join("=").trim().replace(/^["']|["']$/g,"");
const ck = crypto.createHmac("sha256",pw).update(pw).digest("hex");
const browser = await chromium.launch({args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const ctx = await browser.newContext({viewport:{width:1440,height:900}});
await ctx.addCookies([{name:"site_auth",value:ck,domain:"localhost",path:"/"}]);
const page = await ctx.newPage();
const all=[]; const failed=[]; const workerEvents=[];
page.on("request",(r)=>all.push(["REQ",r.url()]));
page.on("response",(r)=>all.push(["RES",r.status(),r.url()]));
page.on("requestfailed",(r)=>failed.push([r.url(), r.failure()?.errorText]));
page.on("worker",(w)=>{
  workerEvents.push(["worker-created", w.url()]);
  w.on("close",()=>workerEvents.push(["worker-closed", w.url()]));
});
page.on("pageerror",(e)=>workerEvents.push(["pageerror", String(e).slice(0,200)]));
await page.goto(BASE+"/dev/origin-map?tea=10101",{waitUntil:"domcontentloaded",timeout:60000});
await page.waitForTimeout(9000);
console.log("WORKER EVENTS:", JSON.stringify(workerEvents,null,1));
console.log("FAILED:", JSON.stringify(failed,null,1));
console.log("BLOB/WORKER-ish REQUESTS:", JSON.stringify(all.filter(a=>/blob:|worker|geo|maplibre/i.test(String(a[a.length-1]))),null,1));
const wk = page.workers();
console.log("workers count:", wk.length);
for (const w of wk) {
  try {
    const info = await w.evaluate(()=>({ self: typeof self, loc: self.location?.href, hasFetch: typeof fetch, keys: Object.keys(self).filter(k=>/maplibre|actor|worker/i.test(k)).slice(0,10) }));
    console.log("WORKER EVAL:", w.url(), JSON.stringify(info));
  } catch(e) { console.log("WORKER EVAL FAIL", w.url(), String(e).slice(0,200)); }
}
await browser.close();
