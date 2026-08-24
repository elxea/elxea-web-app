import { chromium } from "playwright";
import fs from "fs";
const TOKEN = fs.readFileSync("/tmp/wave7_token.txt", "utf8").trim();
const BASE = "http://localhost:3521";
const OUT = "/tmp/circl-boss-elxea-webapp-20260702/scratchpad";
const pages = [
  ["playlists-list", "/ja/playlists"],
  ["playlist-detail", "/ja/playlists/morning-forest"],
  ["journal-list", "/ja/elxea-journal"],
  ["journal-detail", "/ja/elxea-journal/spring-2026"],
  ["search-results", "/ja/search?q=tea"],
  ["search-empty", "/ja/search?q=zzzznotfound"],
];
const viewports = [["pc", 1440, 1024], ["sp", 390, 844]];
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([
  { name: "site_auth", value: TOKEN, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
]);
for (const [vp, w, h] of viewports) {
  const page = await context.newPage();
  await page.setViewportSize({ width: w, height: h });
  for (const [name, path] of pages) {
    const resp = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    const out = `${OUT}/wave7-${name}-${vp}.png`;
    await page.screenshot({ path: out, fullPage: true });
    console.log(`${resp.status()}  ${vp}  ${name}  -> ${out}`);
  }
  await page.close();
}
await browser.close();
console.log("DONE");
