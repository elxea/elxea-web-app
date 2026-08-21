/**
 * Tests for the Shopify OAuth callback's id_token gate — QA audit D1 + 1-0b.
 *
 * Two defects are pinned here, and they are different from each other:
 *
 *   - **nonce (D1)**: `/api/auth/login` has always generated a nonce, sent it to
 *     Shopify, and stored it in `shop_nonce`; the callback deleted that cookie
 *     without ever comparing it. Nothing bound the returned `id_token` to the
 *     authorization request we made.
 *   - **signature (1-0b)**: even once the nonce was compared, the token was read
 *     with a plain Base64 decode. A token nobody signed produced a session, and
 *     every identity decision downstream (`shop_cid`, `id_token_hint`, the
 *     Firestore user key the LINE merge writes into) reads from that token.
 *
 * The tokens here are really signed against a throwaway keypair whose JWKS is
 * served by a stubbed fetch, so a regression to "just decode it" fails instead of
 * passing. `verifyShopifyIdToken` itself is covered case-by-case in
 * `shopify-id-token.test.ts`; this file is about the ROUTE — specifically that a
 * rejection happens before any session cookie exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  TEST_CLIENT_ID,
  TEST_DISCOVERY_URL,
  makeJwksFetch,
  makeKeypair,
  signIdToken,
  validClaims,
} from "./helpers/shopify-oidc-fixtures";

// --- Mocks ------------------------------------------------------------------

const exchangeTokenMock = vi.fn();
const getCustomerMock = vi.fn();

vi.mock("@/lib/shopify/customer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shopify/customer")>(
    "@/lib/shopify/customer",
  );
  return {
    ...actual,
    // Mocked: network, and crypto that needs a real SESSION_SECRET.
    exchangeToken: (...args: unknown[]) => exchangeTokenMock(...args),
    getCustomer: (...args: unknown[]) => getCustomerMock(...args),
    encryptToken: (value: string) => `enc(${value})`,
    decryptToken: (value: string) => value.replace(/^enc\(|\)$/g, ""),
  };
});

const mergeMock = vi.fn();
vi.mock("@/lib/auth/identity-merge", () => ({
  mergeLineIdentityIntoShopify: (...args: unknown[]) => mergeMock(...args),
}));

vi.mock("@/lib/email/welcome", () => ({ sendWelcomeEmail: vi.fn() }));

const captureMessageMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { GET } from "@/app/api/auth/callback/route";
import { __resetShopifyJwksCacheForTests } from "@/lib/shopify/id-token";
import {
  ERROR_KEY_MAP,
  FALLBACK_ERROR_MESSAGE_KEY,
  resolveAuthErrorMessageKey,
} from "@/app/[locale]/login/auth-error-keys";

// --- Helpers ----------------------------------------------------------------

const NONCE = "b6cf1d2e4a7f8091b6cf1d2e4a7f8091";
const keypair = makeKeypair();

function callbackRequest(cookies: Record<string, string>): NextRequest {
  const request = new NextRequest("https://www.elxea.com/api/auth/callback?code=CODE&state=STATE", {
    headers: { host: "www.elxea.com", "x-forwarded-proto": "https" },
  });
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

const HAPPY_COOKIES = {
  shop_cv: "code-verifier",
  shop_state: "STATE",
  shop_nonce: NONCE,
  shop_locale: "ja",
};

function tokenResponse(idToken: string) {
  return {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "Bearer",
    id_token: idToken,
  };
}

/** A token that passes every check — the baseline each test deviates from. */
const goodToken = () => signIdToken(keypair, validClaims(NONCE));

const SAVED = {
  hosts: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
  clientId: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
  discovery: process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL,
};

let realFetch: typeof fetch;

beforeEach(() => {
  vi.clearAllMocks();
  __resetShopifyJwksCacheForTests();
  process.env.LINE_ALLOWED_CALLBACK_HOSTS = "elxea.com,www.elxea.com";
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID = TEST_CLIENT_ID;
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL = TEST_DISCOVERY_URL;
  getCustomerMock.mockResolvedValue(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  /* The route calls `verifyShopifyIdToken` without a fetch override, so the JWKS
   * has to be served through the global. */
  realFetch = globalThis.fetch;
  globalThis.fetch = makeJwksFetch([keypair.jwk]);
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetShopifyJwksCacheForTests();
  globalThis.fetch = realFetch;
  for (const [key, value] of [
    ["LINE_ALLOWED_CALLBACK_HOSTS", SAVED.hosts],
    ["SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID", SAVED.clientId],
    ["SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL", SAVED.discovery],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// --- The route --------------------------------------------------------------

describe("GET /api/auth/callback id_token enforcement", () => {
  it("completes the login when the token is signed and carries our nonce", async () => {
    exchangeTokenMock.mockResolvedValue(tokenResponse(goodToken()));

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://www.elxea.com/ja/account");
    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("shop_at=");
    expect(setCookie).toContain("shop_cid=");
  });

  it("stores the customer id taken from the verified claims", async () => {
    exchangeTokenMock.mockResolvedValue(tokenResponse(goodToken()));

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    /* `encryptToken` is stubbed to `enc(...)`, so this asserts the exact value
     * that reached the cookie — i.e. that it came from `sub` after verification
     * and not from a second, unchecked decode of the same string. */
    expect(response.cookies.get("shop_cid")?.value).toBe("enc(7654321)");
  });

  it("rejects the login when the nonce does not match", async () => {
    exchangeTokenMock.mockResolvedValue(
      tokenResponse(signIdToken(keypair, validClaims("attacker-controlled-nonce"))),
    );

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(response.headers.get("location")).toBe(
      "https://www.elxea.com/ja/login?error=InvalidIdToken",
    );
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Shopify id_token verification failed",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("rejects a token signed by a key that is not Shopify's", async () => {
    /* The case the old decode-only implementation could not see at all: every
     * claim is correct, including the nonce; only the signature is wrong. */
    const attacker = makeKeypair();
    exchangeTokenMock.mockResolvedValue(
      tokenResponse(signIdToken(attacker, validClaims(NONCE))),
    );

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(response.headers.get("location")).toContain("/ja/login?error=InvalidIdToken");
    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).not.toContain("shop_at=enc(");
  });

  it("rejects an unsigned (alg=none) token", async () => {
    exchangeTokenMock.mockResolvedValue(
      tokenResponse(signIdToken(keypair, validClaims(NONCE), { header: { alg: "none" } })),
    );

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(response.headers.get("location")).toContain("/ja/login?error=InvalidIdToken");
  });

  it("establishes no session at all when the token is rejected", async () => {
    exchangeTokenMock.mockResolvedValue(
      tokenResponse(signIdToken(keypair, validClaims("attacker-controlled-nonce"))),
    );

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    /* The load-bearing part: rejection happens before any session cookie is
     * written, so a rejected attempt cannot leave a usable half-session. */
    for (const name of ["shop_at", "shop_rt", "shop_exp", "shop_auth", "shop_it", "shop_cid"]) {
      expect(response.cookies.get(name)).toBeUndefined();
    }
    // ...and the merge never runs, so it cannot be pointed at another user's key.
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("clears the one-shot PKCE cookies on a rejected attempt", async () => {
    exchangeTokenMock.mockResolvedValue(
      tokenResponse(signIdToken(keypair, validClaims("attacker-controlled-nonce"))),
    );

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    const setCookie = response.headers.getSetCookie().join("\n");
    for (const name of ["shop_cv", "shop_state", "shop_nonce", "shop_return_to"]) {
      expect(setCookie).toContain(`${name}=;`);
    }
  });

  it("rejects a token with no nonce claim", async () => {
    const claims = validClaims(NONCE);
    delete claims.nonce;
    exchangeTokenMock.mockResolvedValue(tokenResponse(signIdToken(keypair, claims)));

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(response.headers.get("location")).toContain("/ja/login?error=InvalidIdToken");
  });

  it("rejects when the browser presents no shop_nonce cookie", async () => {
    exchangeTokenMock.mockResolvedValue(tokenResponse(goodToken()));
    const { shop_nonce: _dropped, ...withoutNonce } = HAPPY_COOKIES;

    const response = await GET(callbackRequest(withoutNonce));

    expect(response.headers.get("location")).toContain("/ja/login?error=InvalidIdToken");
  });

  it("rejects the login when Shopify's key set cannot be reached", async () => {
    /* Fail-closed on an unverifiable token. Logging the user in "because the
     * JWKS was down" would restore exactly the behaviour being removed.
     *
     * Distinct key from the token-invalid case on purpose: this is a server-side
     * condition the user cannot fix by retrying immediately, and it is not
     * attacker-controlled, so naming it leaks nothing. */
    globalThis.fetch = makeJwksFetch([keypair.jwk], { failAfter: 0 });
    exchangeTokenMock.mockResolvedValue(tokenResponse(goodToken()));

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(response.headers.get("location")).toContain("/ja/login?error=VerificationUnavailable");
  });

  it("sends the user to a page that actually shows the error", async () => {
    /* The regression this pins: the rejection used to redirect to
     * `/{locale}/account?error=invalid_nonce`. Nothing reads `error` on the account
     * page, and the rejection has just cleared the session cookies — so middleware
     * bounces the request to `/{locale}/login` and DROPS the query string on the
     * way. The user saw a bare login form and no explanation.
     *
     * Two properties are required, and neither alone is enough:
     *   1. the destination is the login page (where the banner lives)
     *   2. the `error` value is a key the banner can resolve */
    exchangeTokenMock.mockResolvedValue(
      tokenResponse(signIdToken(keypair, validClaims("attacker-controlled-nonce"))),
    );

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/ja/login");
    const errorCode = location.searchParams.get("error")!;
    expect(ERROR_KEY_MAP[errorCode]).toBeDefined();
    // ...and it must not fall through to the generic "something went wrong".
    expect(resolveAuthErrorMessageKey(errorCode)).not.toBe(FALLBACK_ERROR_MESSAGE_KEY);
  });

  it("keeps the locale of the attempt in the rejection redirect", async () => {
    exchangeTokenMock.mockResolvedValue(
      tokenResponse(signIdToken(keypair, validClaims("attacker-controlled-nonce"))),
    );

    const response = await GET(
      callbackRequest({ ...HAPPY_COOKIES, shop_locale: "en" }),
    );

    expect(new URL(response.headers.get("location")!).pathname).toBe("/en/login");
  });

  it("does not leak which check failed into the redirect", async () => {
    /* Signature failure and nonce failure must be indistinguishable from outside;
     * the specific reason goes to the log and Sentry only. */
    const attacker = makeKeypair();
    exchangeTokenMock.mockResolvedValue(tokenResponse(signIdToken(attacker, validClaims(NONCE))));
    const signatureFailure = await GET(callbackRequest(HAPPY_COOKIES));

    exchangeTokenMock.mockResolvedValue(tokenResponse(signIdToken(keypair, validClaims("other"))));
    const nonceFailure = await GET(callbackRequest(HAPPY_COOKIES));

    expect(signatureFailure.headers.get("location")).toBe(nonceFailure.headers.get("location"));
  });

  it("still rejects a bad state before the token exchange is attempted", async () => {
    const response = await GET(
      callbackRequest({ ...HAPPY_COOKIES, shop_state: "a-different-state" }),
    );

    expect(response.headers.get("location")).toContain("error=invalid_state");
    expect(exchangeTokenMock).not.toHaveBeenCalled();
  });
});
