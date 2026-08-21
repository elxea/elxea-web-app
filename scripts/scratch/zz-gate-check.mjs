import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext();
// 認証なしの素の文脈で、3 ホストが /password に落とされるか
for (const host of ["https://elxea.com", "https://www.elxea.com", "https://staging.elxea.com"]) {
  const p = await ctx.newPage();
  try {
    const r = await p.goto(host + "/ja/tea-menu", { waitUntil: "domcontentloaded", timeout: 45000, referer: undefined });
    const gated = p.url().includes("/password");
    const hasForm = await p.locator('input[type="password"]').count();
    console.log(`[gate] ${host} -> http=${r.status()} final=${p.url()} gated=${gated} pwField=${hasForm}`);
  } catch (e) {
    console.log(`[gate] ${host} -> ERROR ${String(e).slice(0, 120)}`);
  }
  await p.close();
  await ctx.clearCookies();
}
await b.close();
