/**
 * Production verification for the cookie-consent fix.
 *
 * Part 1 (curl-equivalent): the server-rendered HTML of the public entry point
 *   must carry no GTM markup at all.
 * Part 2 (real browser): after accepting, GTM must appear; the banner must not
 *   come back after a reload; declining must keep GTM out.
 *
 * The site is password protected, so the browser part authenticates first with
 * the site password read from the environment (SITE_PASSWORD) — the password
 * itself is never printed.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "https://elxea.com";
const PASSWORD = process.env.SITE_PASSWORD ?? "";
const BANNER = "このサイトではCookieを使用して";

function countMarkup(html) {
  const count = (re) => (html.match(re) ?? []).length;
  return {
    gtmJs: count(/googletagmanager\.com\/gtm\.js/g),
    nsHtml: count(/googletagmanager\.com\/ns\.html/g),
    anyGtm: count(/googletagmanager\.com/g),
  };
}

const out = {};

// --- Part 1: server-rendered HTML, no browser, no consent -------------------
const res = await fetch(`${BASE}/password`, { redirect: "follow" });
const html = await res.text();
out.ssr_password_page = { status: res.status, ...countMarkup(html) };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Authenticate past the site password gate.
  await page.goto(`${BASE}/password`, { waitUntil: "domcontentloaded" });
  if (PASSWORD) {
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.endsWith("/password"), { timeout: 30000 });
  }

  const gtmRequests = [];
  page.on("request", (r) => {
    if (r.url().includes("googletagmanager.com")) gtmRequests.push(r.url());
  });

  const readState = async () => ({
    banner: await page
      .getByText(BANNER)
      .first()
      .isVisible()
      .catch(() => false),
    gtmScript: await page.locator("#gtm-script").count(),
    gtmMarkup: await page.evaluate(() =>
      document.documentElement.innerHTML.includes("googletagmanager.com"),
    ),
    stored: await page.evaluate(() => localStorage.getItem("cookie-consent")),
  });

  await page.goto(`${BASE}/ja`, { waitUntil: "networkidle" });
  out["1_before_choice"] = { ...(await readState()), gtmRequests: [...gtmRequests] };

  // Decline
  await page.getByRole("button", { name: "必要なもののみ" }).click();
  await page.waitForTimeout(2000);
  out["2_after_decline"] = { ...(await readState()), gtmRequests: [...gtmRequests] };

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  out["3_decline_reload"] = { ...(await readState()), gtmRequests: [...gtmRequests] };

  // Switch to accept via the footer entry, in a fresh context to keep it clean
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  const gtm2 = [];
  p2.on("request", (r) => {
    if (r.url().includes("googletagmanager.com")) gtm2.push(r.url());
  });
  await p2.goto(`${BASE}/password`, { waitUntil: "domcontentloaded" });
  if (PASSWORD) {
    await p2.fill('input[type="password"]', PASSWORD);
    await p2.click('button[type="submit"]');
    await p2.waitForURL((u) => !u.pathname.endsWith("/password"), { timeout: 30000 });
  }
  await p2.goto(`${BASE}/ja`, { waitUntil: "networkidle" });
  await p2.getByRole("button", { name: "同意する" }).click();
  await p2.waitForTimeout(3000);
  out["4_after_accept"] = {
    banner: await p2.getByText(BANNER).first().isVisible().catch(() => false),
    gtmScript: await p2.locator("#gtm-script").count(),
    stored: await p2.evaluate(() => localStorage.getItem("cookie-consent")),
    gtmRequests: [...gtm2],
  };

  await p2.reload({ waitUntil: "networkidle" });
  await p2.waitForTimeout(3000);
  out["5_accept_reload"] = {
    banner: await p2.getByText(BANNER).first().isVisible().catch(() => false),
    gtmScript: await p2.locator("#gtm-script").count(),
    stored: await p2.evaluate(() => localStorage.getItem("cookie-consent")),
    consentCookie: await p2.evaluate(() =>
      document.cookie.includes("cookie_consent="),
    ),
    gtmRequests: [...gtm2],
  };

  // Cross-host: does the apex see the choice made on www (or vice versa)?
  const otherHost = BASE.includes("://www.")
    ? BASE.replace("://www.", "://")
    : BASE.replace("://", "://www.");
  await p2.goto(`${otherHost}/ja`, { waitUntil: "networkidle" }).catch(() => {});
  await p2.waitForTimeout(2500);
  out["6_other_host"] = {
    host: otherHost,
    url: p2.url(),
    banner: await p2.getByText(BANNER).first().isVisible().catch(() => false),
    stored: await p2.evaluate(() => localStorage.getItem("cookie-consent")),
    cookieVisible: await p2.evaluate(() => document.cookie.includes("cookie_consent=")),
  };
} finally {
  await browser.close();
}

console.log(JSON.stringify(out, null, 2));
