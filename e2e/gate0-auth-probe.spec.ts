import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

/**
 * Stage 0 probe — proves the Ring 2 checks fail on TODAY's code, for the
 * reasons the design claims. This is the "does the thermometer read a fever"
 * step the design's GATE requires before any fix is written. It is superseded
 * by `auth-session-flow.spec.ts` once stage 6 lands.
 *
 * The Shopify logout contract is served by a REAL local stub process
 * (`scripts/e2e/shopify-logout-stub.mjs`), not by `page.route`. Measured
 * 2026-08-18 01:12 JST: a catch-all `context.route("**\/*")` logged the
 * `/api/auth/logout` navigation but NEVER the cross-origin redirect target, and
 * the browser went on to resolve DNS for it. Playwright cannot intercept the
 * cross-origin hop of a top-level navigation redirect, so `stubHits` as
 * specified in the design is unobtainable that way.
 */

const FAKE_APEX = ".elxea.test";
const LINE_SESSION_COOKIES = ["line_user", "line_session", "line_auth", "line_uid"] as const;
const STUB_LOG = process.env.SHOPIFY_LOGOUT_STUB_LOG ?? "";

type StubHit = {
  hits: number;
  path: string;
  hasIdTokenHint: boolean;
  hasPostLogoutRedirectUri: boolean;
  verdict: number;
};

function readStubHits(): StubHit[] {
  if (!STUB_LOG) return [];
  try {
    return readFileSync(STUB_LOG, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as StubHit);
  } catch {
    return [];
  }
}

test.describe.serial("stage 0 — today's code must be red", () => {
  /* Stage 0-pre is the one check here that must be GREEN, because it validates
   * the harness rather than the app: if the fake apex cannot load the dev
   * server cleanly, every observation below is measuring the harness. */
  test("0-pre: the fake apex loads with zero console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    const externalHosts = new Set<string>();
    page.on("request", (r) => {
      const h = new URL(r.url()).host;
      if (h !== "www.elxea.test:3310") externalHosts.add(h);
    });

    await page.goto("/ja", { waitUntil: "load" });
    // HMR / dev-resource blocking surfaces asynchronously after load.
    await page.waitForTimeout(6000);

    const ctx = await page.evaluate(() => ({
      isSecureContext: window.isSecureContext,
      hasRandomUUID: typeof crypto?.randomUUID === "function",
      hasSubtle: typeof crypto?.subtle === "object",
      origin: location.origin,
    }));

    console.log(`[gate0][0-pre] platform: ${JSON.stringify(ctx)}`);
    console.log(`[gate0][0-pre] console errors: ${errors.length}`);
    errors.forEach((e) => console.log(`[gate0][0-pre]   ERR ${e.slice(0, 200)}`));
    console.log(
      `[gate0][0-pre] non-baseURL hosts contacted: ${[...externalHosts].join(", ") || "(none)"}`,
    );

    /* What stage 0-pre actually had to prove: `allowedDevOrigins` silences the
     * cross-origin dev-resource block. This is the assertion that matters. */
    expect(
      errors.filter((e) => /cross-origin|webpack-hmr|Blocked/i.test(e)),
      "allowedDevOrigins must silence the cross-origin dev-resource block",
    ).toEqual([]);

    /* Measured 2026-08-18 01:23 JST, and NOT anticipated by the design:
     * `http://www.elxea.test:3310` is not a secure context (only https and
     * localhost/127.0.0.1 are), so `crypto.randomUUID` is undefined and the chat
     * provider throws on mount. The design's S0/S7 assertion "console errors ===
     * 0" is therefore unreachable on the fake apex as specified.
     *
     * This is recorded as a KNOWN, EXPLAINED error rather than silently ignored:
     * anything else appearing here still fails, so the check keeps its teeth
     * while the design decision (guard the call site vs. serve Ring 2 over
     * https) is pending. */
    const KNOWN_ERRORS: Array<[RegExp, string]> = [
      [
        /crypto\.randomUUID is not a function/,
        "secure-context gap: components/chat/chat-provider.tsx:76 calls crypto.randomUUID, " +
          "which exists only in secure contexts. Needs a design decision (guard the call " +
          "site, or serve Ring 2 over https).",
      ],
      [
        /Failed to fetch site settings/,
        "env parity: NEXT_PUBLIC_SANITY_PROJECT_ID is empty in this run. ci.yml:313-329 " +
          "supplies it in CI, so this is a local-env artefact, not a fake-apex problem.",
      ],
    ];
    const unexplained = errors.filter((e) => !KNOWN_ERRORS.some(([re]) => re.test(e)));
    expect(unexplained, "no console errors beyond the two documented ones").toEqual([]);

    /* Pin the measured platform facts. If Chromium ever starts treating this
     * origin as a secure context these flip, and the note above gets revisited
     * deliberately rather than by drift. */
    expect(ctx.isSecureContext, "fake apex over http is not a secure context").toBe(false);
    expect(ctx.hasRandomUUID, "crypto.randomUUID absent outside a secure context").toBe(false);
    expect(ctx.hasSubtle, "crypto.subtle absent outside a secure context").toBe(false);
  });

  test("0a-iii: shared-domain LINE cookies survive logout on unpatched code", async ({
    page,
    context,
    baseURL,
  }) => {
    const hitsBefore = readStubHits().length;

    await page.goto("/ja");

    /* Inject the LINE session the way production issues it: Domain-scoped to
     * the apex. `secure: false` because Ring 2 speaks plain http — which is
     * also why the dev server, not `next start`, has to be used. */
    await context.addCookies(
      LINE_SESSION_COOKIES.map((name) => ({
        name,
        value: name === "line_user" ? JSON.stringify({ displayName: "Gate0Probe" }) : "1",
        domain: FAKE_APEX,
        path: "/",
        secure: false,
        httpOnly: false,
      })),
    );

    const beforeShared = (await context.cookies(baseURL!)).filter(
      (c) => c.domain === FAKE_APEX && LINE_SESSION_COOKIES.includes(c.name as never),
    );
    expect(beforeShared.length, "precondition: 4 Domain-scoped LINE cookies injected").toBe(4);

    /* Sanity: the injected jar actually reaches the server. If this view does
     * not render, a later "cookies survived" result would prove nothing. */
    /* Server-rendered HTML, not a client visibility check: the account page also
     * fires client fetches (favorites / follows / Sanity site settings) that can
     * race the paint, which made a getByText() assertion flaky. The document HTML
     * is the deterministic evidence that the injected jar reached the server.
     *
     * It must be read through the PAGE, not `context.request`: APIRequestContext
     * runs in Node, where `--host-resolver-rules` does not apply, so the fake apex
     * is unresolvable there (the same Node-vs-Chromium asymmetry that forces
     * `webServer.url` to be 127.0.0.1). Measured 2026-08-18 01:30 JST. */
    await page.goto("/ja/account");
    const preHtml = await page.content();
    console.log(
      `[gate0][0a-iii] BEFORE logout: /ja/account renders LINE view = ${preHtml.includes("Gate0Probe")}`,
    );
    expect(preHtml, "precondition: injected jar reaches the server").toContain("Gate0Probe");

    await page.goto("/api/auth/logout?locale=ja");
    await page.waitForLoadState("domcontentloaded");

    const remainingShared = (await context.cookies(baseURL!))
      .filter((c) => c.domain === FAKE_APEX && LINE_SESSION_COOKIES.includes(c.name as never))
      .map((c) => `${c.name}@${c.domain}`)
      .sort();

    const newHits = readStubHits().slice(hitsBefore);

    console.log(
      `[gate0][0a-iii] remaining Domain-scoped LINE cookies after logout: ${
        remainingShared.length === 0 ? "(none)" : remainingShared.join(", ")
      }`,
    );
    console.log(`[gate0][0a-iii] stub hits during logout: ${JSON.stringify(newHits)}`);

    /* THE RED: today's delete carries no Domain, so every Domain-scoped LINE
     * cookie survives. */
    expect(
      remainingShared,
      "unpatched: Domain-scoped LINE cookies must still be present (this IS the hole)",
    ).toEqual([
      "line_auth@.elxea.test",
      "line_session@.elxea.test",
      "line_uid@.elxea.test",
      "line_user@.elxea.test",
    ]);

    /* And the consequence that makes it a security defect rather than litter:
     * `middleware.ts:140-151` authorises /account on `line_session` alone, so
     * the account page is still reachable after "logging out". */
    await page.goto("/ja/account");
    console.log(
      `[gate0][0a-iii] /ja/account after logout landed on: ${new URL(page.url()).pathname}`,
    );
    expect(new URL(page.url()).pathname).toBe("/ja/account");
    const postHtml = await page.content();
    console.log(
      `[gate0][0a-iii] AFTER logout: /ja/account still renders LINE view = ${postHtml.includes("Gate0Probe")}`,
    );
    expect(postHtml, "unpatched: still authenticated after logout").toContain("Gate0Probe");
  });

  test("0b: unauthenticated logout leaves the site and the contract answers 400", async ({
    page,
  }) => {
    const hitsBefore = readStubHits().length;

    const non2xx: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) non2xx.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });

    await page.goto("/ja");
    await page.goto("/api/auth/logout?locale=ja");
    await page.waitForLoadState("domcontentloaded");

    const body = await page.content();
    const newHits = readStubHits().slice(hitsBefore);

    console.log(`[gate0][0b] stub hits: ${JSON.stringify(newHits)}`);
    console.log(`[gate0][0b] non-2xx observed: [${non2xx.join(" | ")}]`);

    /* THE RED: today's code goes out to Shopify even with no id_token to hint
     * with, omits `id_token_hint`, and the contract answers 400. */
    expect(newHits.length, "unpatched: logout must still leave the site").toBeGreaterThanOrEqual(1);
    expect(newHits[0].hasIdTokenHint, "unpatched: id_token_hint must be absent").toBe(false);
    expect(newHits[0].verdict, "contract: no hint => 400").toBe(400);
    expect(body).toContain("invalid_request");
  });
});
