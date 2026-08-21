import pw from "/Users/setaka/github/elxea/products/elxea-web-app/node_modules/playwright/index.js";
const { chromium } = pw;
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3300";
const OUT = "/tmp/roji-map-final2";
const cookie = readFileSync("/tmp/roji-cookie.txt", "utf8").trim();

const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
await ctx.addCookies([
  { name: "site_auth", value: cookie, domain: "localhost", path: "/" },
]);

const targets = [
  ["04-no-origin", { width: 1440, height: 900 }],
  ["04b-no-origin-sp", { width: 390, height: 844 }],
];

for (const [name, vp] of targets) {
  const page = await ctx.newPage();
  await page.setViewportSize(vp);
  await page.goto(BASE + "/ja/tea-menu/uji-gyokuro", {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  // Dismiss the cookie banner so it does not cover the region under inspection.
  await page
    .getByRole("button", { name: "必要なもののみ" })
    .click({ timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  // Scroll to the seam where the origin block would sit:
  // 詳細表 (お茶の詳細) の直後、淹れ方ガイドの手前。
  const y = await page.evaluate(() => {
    const guide = [...document.querySelectorAll("h2")].find((h) =>
      h.innerText.includes("淹れ方"),
    );
    return guide ? guide.getBoundingClientRect().top + window.scrollY : null;
  });
  if (y !== null) {
    await page.evaluate((t) => window.scrollTo(0, Math.max(0, t - 420)), y);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });

  const audit = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasOriginBlock: !!document.querySelector('[data-slot="tea-origin-block"]'),
      hasMapFrame: !!document.querySelector('[data-slot="origin-map-frame"]'),
      h2s: [...document.querySelectorAll("h2")].map((h) => h.innerText),
      // Untranslated next-intl keys surface either as `namespace.key` or bare camelCase ids.
      suspiciousKeys: (
        text.match(/\b[a-z]+[A-Z][A-Za-z]*\.[A-Za-z.]+\b|\borigin(?:MapAlt|MapAltUnknown)\b/g) ||
        []
      ).slice(0, 10),
    };
  });
  console.log(name, JSON.stringify(audit));
  await page.close();
}
await browser.close();
