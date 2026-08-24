import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3111";
const PATHS = (process.env.PATHS ?? "/ja/elxea-journal").split(",");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
for (const p of PATHS) {
  const res = await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  const d = await page.evaluate(() => {
    const cls = (e) => (typeof e.className === "string" ? e.className : "");
    const hits = [...document.querySelectorAll("*")].filter((e) => cls(e).includes("bg-muted"));
    return {
      title: document.title,
      anchors: [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")))].slice(0, 30),
      dataSlots: [...new Set([...document.querySelectorAll("[data-slot]")].map((e) => e.getAttribute("data-slot")))],
      mutedEls: hits.slice(0, 15).map((e) => ({ tag: e.tagName, cls: cls(e).slice(0, 170) })),
      mutedCount: hits.length,
      buttons: [...document.querySelectorAll("button")].slice(0, 12).map((b) => ({ text: (b.textContent || "").trim().slice(0, 28), cls: cls(b).slice(0, 150) })),
    };
  });
  console.log("=====", p, "status", res?.status());
  console.log(JSON.stringify(d, null, 2));
}
await browser.close();
