import { readFileSync } from "node:fs";

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

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

/** Where the fake LINE server listens. Supplied by the config so both sides agree. */
const LINE_ORIGIN = process.env.E2E_AUTH_FLOW_LINE_ORIGIN!;

/**
 * The LINE account the fake server hands back on a real login.
 *
 * The id ***must*** be `U` + 32 hex: `verifyLineIdToken` rejects anything else as
 * "not a valid Messaging userId". The old stub returned `U-ring2-user`, which
 * cannot pass that check — one of the two reasons the success path was
 * unreachable.
 *
 * ASCII display name: a non-ASCII cookie value did not survive `addCookies` to
 * the server (measured at stage 0), and S1 asserts the same string after
 * injecting it, so both routes into this name stay ASCII.
 */
const LINE_USER_ID = `U${"1".repeat(32)}`;
const LINE_DISPLAY_NAME = "RingTwoUser";

/** Hosts that are legitimately contacted and are not our own origin. */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  /* Typekit ships the site's webfonts; it is loaded on every page. Measured at
   * stage 0 — the design's original "zero external requests" assertion was not
   * reachable, so the check is an allow-list rather than a count of zero. */
  "use.typekit.net",
  "p.typekit.net",
  /* The site's own photo CDN (R2 managed public domain). `lib/site-assets.ts`
   * (R2_PUBLIC_DOMAIN) and `next.config.ts` images.remotePatterns declare it as
   * the first-party host every `SiteImage*` slot is served from. It started to
   * appear on the pages this flow walks once the photo pipeline began assigning
   * photos to the site slots (2026-09-03); it is not a session-leak vector, so
   * allow-list it rather than count it as an unexpected host. Value mirrors the
   * env override the app itself honours. */
  process.env.R2_PUBLIC_DOMAIN ?? "pub-90a0485599904fee8228ef56bb51c2e6.r2.dev",
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
      value: name === "line_user" ? JSON.stringify({ displayName: LINE_DISPLAY_NAME }) : "1",
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

/**
 * Drive the REAL /api/line-callback success path.
 *
 * The state cookie is issued by /api/line-login/init, so the flow is started
 * properly rather than forged. From there the browser follows the authorize URL
 * to the fake LINE server, which redirects back with a real `code` — the same
 * hops a phone makes.
 *
 * Previously this jumped straight to `/api/line-callback?code=ring2-code`, with
 * a stub that answered `/oauth2/v2.1/verify` with `{ email }` and nothing else.
 * Once the id_token became a GATE (aud / iss / exp / sub / nonce, D11), that
 * shortcut could no longer reach SUCCESS: the callback rejected the token and
 * issued no session, so S3 failed and — this being a `describe.serial` — the
 * other eight tests never ran. Measured on `main` at fc4cbb2. Going through
 * authorize is what makes the id_token belong to this authorization request.
 */
async function completeLineLogin(
  page: Page,
  context: BrowserContext,
  request: APIRequestContext,
) {
  /* Who is "signed in" on the fake LINE side. Set explicitly rather than relying
   * on the fake's default, so this spec states its own expectations. */
  const setUser = await request.post(`${LINE_ORIGIN}/__control/line-user`, {
    data: { userId: LINE_USER_ID, displayName: LINE_DISPLAY_NAME },
  });
  expect(setUser.ok(), "fake LINE must accept the user switch").toBe(true);

  await page.goto("/ja");

  const init = await page.evaluate(async () => {
    const r = await fetch("/api/line-login/init", { method: "POST", credentials: "same-origin" });
    return { status: r.status, body: await r.text() };
  });
  expect(init.status, `init must succeed on the fake apex: ${init.body}`).toBe(200);

  const authUrl = JSON.parse(init.body).authUrl as string;
  expect(
    new URL(authUrl).searchParams.get("state"),
    "init must have issued a CSRF state",
  ).toBeTruthy();

  await page.goto(authUrl);
  await page.waitForLoadState("domcontentloaded");

  return { cookies: await context.cookies(`http://${BASE_HOST}`) };
}

test.describe.serial("auth session flow", () => {
  test("S3: the real LINE callback logs the user in and scopes the session to the apex", async ({
    page,
    context,
    request,
  }) => {
    const { cookies } = await completeLineLogin(page, context, request);

    /* The exact regression that shipped: the callback issued these four and then
     * cleared the state cookie on the same response, and the clear was deleting
     * them. A suite that never drove this path could not see it. */
    const session = cookies.filter(
      (c) => LINE_SESSION_COOKIES.includes(c.name as never) && c.value !== "",
    );
    expect(
      session.map((c) => c.name).sort(),
      "all four session cookies must reach the browser with a value",
    ).toEqual([...LINE_SESSION_COOKIES].sort());
    expect(session.every((c) => c.domain === FAKE_APEX), "must be apex-scoped").toBe(true);

    /* The one-shot state cookie must be gone. */
    expect(cookies.filter((c) => c.name === "line_oauth_state" && c.value !== "")).toEqual([]);

    /* And the session must actually authorise — the point of having one. */
    await page.goto("/ja/account");
    expect(await page.content()).toContain(LINE_DISPLAY_NAME);
  });

  test("S2: an authenticated user can navigate the site normally", async ({
    page,
    context,
    request,
  }) => {
    await completeLineLogin(page, context, request);

    const non2xx: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) non2xx.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });

    await page.goto("/ja/cart");
    await page.waitForURL(/\/ja\/cart/);
    expect(new URL(page.url()).origin).toBe(`http://${BASE_HOST}`);

    /* Favourites / follows need Firebase credentials the harness does not have,
     * and answer 401 — measured at stage 0, and the only non-2xx allowed here. */
    const unexpected = non2xx.filter((s) => !/401 \/api\/user\//.test(s));
    expect(unexpected, `unexpected non-2xx: ${non2xx.join(" | ")}`).toEqual([]);
  });

  test("S7: a full login-then-logout round trip leaves no session behind", async ({
    page,
    context,
    request,
  }) => {
    const externalHosts = new Set<string>();
    page.on("request", (r) => {
      const host = new URL(r.url()).host;
      if (host !== BASE_HOST && !host.startsWith("127.0.0.1:")) externalHosts.add(host);
    });

    await completeLineLogin(page, context, request);
    await page.goto("/ja/account");
    expect(await page.content()).toContain(LINE_DISPLAY_NAME);

    await page.goto("/api/auth/logout?locale=ja");
    await page.waitForLoadState("domcontentloaded");

    const after = await context.cookies(`http://${BASE_HOST}`);
    expect(
      after.filter((c) => LINE_SESSION_COOKIES.includes(c.name as never) && c.value !== ""),
      "no session cookie may survive logout",
    ).toEqual([]);

    await page.goto("/ja/account");
    await page.waitForURL(/\/ja\/login/);

    for (const host of externalHosts) {
      expect(ALLOWED_EXTERNAL_HOSTS.has(host), `unexpected external host ${host}`).toBe(true);
    }
  });

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
    expect(await page.content()).toContain(LINE_DISPLAY_NAME);

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
    expect(await page.content()).toContain(LINE_DISPLAY_NAME);

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
    expect(await page.content()).toContain(LINE_DISPLAY_NAME);

    const second = await context.newPage();
    await second.goto("/ja/account");
    expect(await second.content()).toContain(LINE_DISPLAY_NAME);

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
