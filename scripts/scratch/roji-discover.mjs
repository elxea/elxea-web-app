import { chromium } from "playwright";

const base = "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

for (const path of ["/ja/elxea-journal", "/ja/journal", "/ja/tea-menu", "/ja/farmers"]) {
  await page.goto(base + path, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  const links = await page.$$eval("main a[href]", (as) =>
    Array.from(new Set(as.map((a) => a.getAttribute("href")))).filter(Boolean),
  );
  console.log("===", path);
  console.log(links.filter((l) => l.split("/").length >= 4).slice(0, 15).join("\n"));
  const body = await page.$eval("main", (m) => m.innerText.slice(0, 300));
  console.log("--- text:", JSON.stringify(body));
}

await browser.close();
