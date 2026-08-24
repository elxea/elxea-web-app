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
await ctx.addInitScript(() => {
  window.__workerCalls = [];
  const Real = window.Worker;
  window.Worker = class extends Real {
    constructor(url, opts) {
      const rec = { url: String(url), opts: JSON.stringify(opts || {}), blobBody: null };
      if (String(url).startsWith("blob:")) {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", String(url), false);
          xhr.send();
          rec.blobBody = xhr.responseText.slice(0, 500);
        } catch (e) { rec.blobBody = "READ FAIL " + e; }
      }
      window.__workerCalls.push(rec);
      super(url, opts);
      this.addEventListener("error", (e) => {
        rec.error = `${e.message} @ ${e.filename}:${e.lineno}`;
        window.__workerCalls.push({ ...rec, tag: "onerror" });
      });
    }
  };
});
const page = await ctx.newPage();
page.on("pageerror",(e)=>console.log("PAGEERROR:", String(e).slice(0,200)));
await page.goto(BASE+"/dev/origin-map?tea=10101",{waitUntil:"domcontentloaded",timeout:60000});
await page.waitForTimeout(9000);
console.log("WORKER CONSTRUCTOR CALLS:", JSON.stringify(await page.evaluate(()=>window.__workerCalls), null, 1));
await browser.close();
