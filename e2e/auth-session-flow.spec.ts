import { readFileSync } from "node:fs";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Ring 2 — the login/logout round trip, run behind a fake apex so the PRODUCTION
 * cookie-Domain branch actually executes.
 *
 * On `localhost` `resolveCookieDomain()` returns undefined, so a suite that ran
 * there would never exercise the Domain-scoped deletion that this whole change is
 * about — it would pass while checking nothing. `AUTH_COOKIE_APEX=elxea.test`
 * plus Chromium's `--host-resolver-rules` puts the dev server behind
 * `www.elxea.test` with no DNS or /etc/hosts involvement.
 *
 * This supersedes `gate0-auth-probe.spec.ts`, which asserted the same mechanisms
 * were BROKEN. The stage-0 measurements it recorded are preserved in
 * docs/release-gates/gate0-e7121ae.md.
 */

const FAKE_APEX = ".elxea.test";
const BASE_HOST = "www.elxea.test:3310";
const LINE_SESSION_COOKIES = ["line_user", "line_session", "line_auth", "line_uid"] as const;

/** Hosts that are legitimately contacted and are not our own origin. */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  /* Typekit ships the site's webfonts; it is loaded on every page. Measured at
   * stage 0 — the design's original "zero external requests" assertion was not
   * reachable, so the check is an allow-list rather than a count of zero. */
  "use.typekit.net",
  "p.typekit.net",
]);

type StubHit = { hits: number; path: string; hasIdTokenHint: boolean; verdict: number };

function readStubHits(): StubHit[] {
  const log = process.env.SHOPIFY_LOGOUT_STUB_LOG;
  if (!log) return [];
  try {
    return readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as StubHit);
  } catch {
    return [];
  }
}

/** Records every host contacted and every non-2xx, for the end-of-run checks. */
function instrument(page: Page) {
  const externalHosts = new Set<string>();
  const non2xx: string[] = [];
  page.on("request", (r) => {
    const host = new URL(r.url()).host;
    if (host !== BASE_HOST) externalHosts.add(host);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) non2xx.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return { externalHosts, non2xx };
}

async function injectLineSession(context: BrowserContext) {
  await context.addCookies(
    LINE_SESSION_COOKIES.map((name) => ({
      name,
      /* ASCII only: a non-ASCII cookie value did not survive `addCookies` to the
       * server (measured at stage 0), which would have made the "session
       * reached the server" precondition silently false. */
      value: name === "line_user" ? JSON.stringify({ displayName: "RingTwoUser" }) : "1",
      domain: FAKE_APEX,
      path: "/",
      secure: false,
      httpOnly: false,
    })),
  );
}

function sharedDomainLineCookies(cookies: { name: string; domain: string }[]) {
  return cookies
    .filter(
      (c) => c.domain === FAKE_APEX && LINE_SESSION_COOKIES.includes(c.name as never),
    )
    .map((c) => c.name)
    .sort();
}

test.describe.serial("auth session flow", () => {
  test("S0: unauthenticated home identifies its build and shows no logout link", async ({
    page,
  }) => {
    const { externalHosts } = instrument(page);
    await page.goto("/ja");

    expect(new URL(page.url()).origin).toBe(`http://${BASE_HOST}`);

    /* Build identity. The expected SHA is supplied to the dev server by the
     * config, evaluated in Node — not as a literal "$(...)" string, which would
     * compare against something that can never match and make this check
     * permanently green-by-accident. */
    const expected = process.env.VERCEL_GIT_COMMIT_SHA;
    const meta = await page
      .locator('meta[name="x-elxea-commit"]')
      .getAttribute("content");

    expect(expected, "the harness must supply an expected SHA").toBeTruthy();
    expect(meta, "meta tag must be present").toBeTruthy();
    /* Fail closed: a build with no VCS metadata reports "local", and treating
     * that as a pass would mean the check never actually compares anything. */
    expect(meta).not.toBe("local");
    expect(meta).not.toBe("");
    expect(meta).toBe(expected!.slice(0, 7));

    await expect(page.locator('header a[href*="/api/auth/logout"]')).toHaveCount(0);
    for (const host of externalHosts) {
      expect(ALLOWED_EXTERNAL_HOSTS.has(host), `unexpected external host ${host}`).toBe(true);
    }
  });

  test("S1: an apex-scoped LINE session is recognised by the server", async ({
    page,
    context,
  }) => {
    await page.goto("/ja");
    await injectLineSession(context);

    /* The proof that the injected jar reached the SERVER is server-rendered
     * markup, not the jar's own contents. Read through the page rather than
     * `context.request`: APIRequestContext runs in Node, where the fake apex does
     * not resolve. */
    await page.goto("/ja/account");
    expect(await page.content()).toContain("RingTwoUser");

    await expect(page.locator('header a[href*="/api/auth/logout"]').first()).toBeVisible();
  });

  test("S4: logout clears the apex-scoped session without leaving the site", async ({
    page,
    context,
  }) => {
    const hitsBefore = readStubHits().length;
    const { externalHosts } = instrument(page);

    await page.goto("/ja");
    await injectLineSession(context);
    await page.goto("/ja/account");
    expect(await page.content()).toContain("RingTwoUser");

    await page.goto("/api/auth/logout?locale=ja");
    await page.waitForLoadState("domcontentloaded");

    /* A LINE-only user holds no Shopify id_token, so logout must complete
     * locally. Any stub hit here means we went to Shopify without a hint and
     * would have been answered 400 — the original defect. */
    expect(readStubHits().slice(hitsBefore), "must not call Shopify").toEqual([]);
    expect(new URL(page.url()).origin).toBe(`http://${BASE_HOST}`);

    const remaining = sharedDomainLineCookies(await context.cookies(`http://${BASE_HOST}`));
    expect(remaining, "no Domain-scoped LINE cookie may survive").toEqual([]);

    for (const host of externalHosts) {
      expect(ALLOWED_EXTERNAL_HOSTS.has(host), `unexpected external host ${host}`).toBe(true);
    }
  });

  test("S5: logging out while unauthenticated is a clean no-op", async ({ page }) => {
    const hitsBefore = readStubHits().length;

    await page.goto("/ja");
    await page.goto("/api/auth/logout?locale=ja");
    await page.waitForLoadState("domcontentloaded");

    expect(readStubHits().slice(hitsBefore), "must not call Shopify").toEqual([]);
    expect(new URL(page.url()).pathname).toBe("/ja");

    const body = await page.content();
    for (const marker of ["invalid_request", "Bad Request"]) {
      expect(body).not.toContain(marker);
    }
  });

  test("S6: /account is not reachable after logout", async ({ page, context }) => {
    await page.goto("/ja");
    await injectLineSession(context);
    await page.goto("/api/auth/logout?locale=ja");

    await page.goto("/ja/account");
    await page.waitForURL(/\/ja\/login/);
    expect(new URL(page.url()).pathname).toBe("/ja/login");
  });

  test("S8: a second tab is logged out too, and going back cannot re-enter", async ({
    page,
    context,
  }) => {
    await page.goto("/ja");
    await injectLineSession(context);
    await page.goto("/ja/account");
    expect(await page.content()).toContain("RingTwoUser");

    const second = await context.newPage();
    await second.goto("/ja/account");
    expect(await second.content()).toContain("RingTwoUser");

    await page.goto("/api/auth/logout?locale=ja");

    /* The session lived in a Domain-scoped cookie shared by the whole context, so
     * clearing it must log the other tab out as well. */
    await second.goto("/ja/account");
    await second.waitForURL(/\/ja\/login/);
    expect(new URL(second.url()).pathname).toBe("/ja/login");

    /* A cached page may still paint, but navigating from it must not get back in. */
    await page.goBack().catch(() => null);
    await page.goto("/ja/account");
    await page.waitForURL(/\/ja\/login/);
    expect(new URL(page.url()).pathname).toBe("/ja/login");

    await second.close();
  });
});
