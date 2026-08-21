/**
 * Tests for the Shopify OAuth nonce check — QA audit D1.
 *
 * `/api/auth/login` has always generated a nonce, sent it to Shopify, and stored
 * it in `shop_nonce`; the callback deleted that cookie without ever comparing
 * it. So nothing bound the returned `id_token` to the authorization request we
 * made, while every identity decision downstream (`shop_cid`, `id_token_hint`,
 * and the Firestore user key the LINE merge writes into) reads from that token.
 *
 * Two layers are pinned here:
 *   - `verifyIdTokenNonce` as a predicate, including every fail-closed case.
 *   - The route: a mismatch must be rejected BEFORE any session cookie exists,
 *     and a match must still log in exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// --- Mocks ------------------------------------------------------------------

const exchangeTokenMock = vi.fn();
const getCustomerMock = vi.fn();

vi.mock("@/lib/shopify/customer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shopify/customer")>(
    "@/lib/shopify/customer",
  );
  return {
    ...actual,
    // Real: these are what is under test.
    verifyIdTokenNonce: actual.verifyIdTokenNonce,
    extractCustomerIdFromIdToken: actual.extractCustomerIdFromIdToken,
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
import { verifyIdTokenNonce, extractNonceFromIdToken } from "@/lib/shopify/customer";

// --- Helpers ----------------------------------------------------------------

const b64url = (value: string) => Buffer.from(value, "utf8").toString("base64url");

/** An unsigned JWT with the given payload. Only the payload is ever read. */
function idTokenWith(payload: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify(payload),
  )}.signature-not-verified`;
}

const NONCE = "b6cf1d2e4a7f8091b6cf1d2e4a7f8091";
const CUSTOMER_GID = "gid://shopify/Customer/7654321";

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

function tokenResponse(nonce: string | undefined) {
  return {
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    token_type: "Bearer",
    id_token: idTokenWith({ sub: CUSTOMER_GID, ...(nonce === undefined ? {} : { nonce }) }),
  };
}

const SAVED_HOSTS = process.env.LINE_ALLOWED_CALLBACK_HOSTS;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LINE_ALLOWED_CALLBACK_HOSTS = "elxea.com,www.elxea.com";
  getCustomerMock.mockResolvedValue(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (SAVED_HOSTS === undefined) delete process.env.LINE_ALLOWED_CALLBACK_HOSTS;
  else process.env.LINE_ALLOWED_CALLBACK_HOSTS = SAVED_HOSTS;
});

// --- The predicate ----------------------------------------------------------

describe("verifyIdTokenNonce", () => {
  it("accepts a token carrying the nonce we issued", () => {
    expect(verifyIdTokenNonce(idTokenWith({ nonce: NONCE }), NONCE)).toBe(true);
  });

  it("rejects a token carrying a different nonce", () => {
    expect(verifyIdTokenNonce(idTokenWith({ nonce: "some-other-nonce" }), NONCE)).toBe(false);
  });

  it("rejects when the token has no nonce claim at all", () => {
    expect(verifyIdTokenNonce(idTokenWith({ sub: CUSTOMER_GID }), NONCE)).toBe(false);
  });

  it("rejects when we have no saved nonce to compare against", () => {
    // Fail-closed: an absent cookie must not become an exemption.
    expect(verifyIdTokenNonce(idTokenWith({ nonce: NONCE }), undefined)).toBe(false);
    expect(verifyIdTokenNonce(idTokenWith({ nonce: NONCE }), "")).toBe(false);
  });

  it("rejects a malformed token instead of throwing", () => {
    expect(verifyIdTokenNonce("not-a-jwt", NONCE)).toBe(false);
    expect(verifyIdTokenNonce("a.!!!not-base64-json!!!.c", NONCE)).toBe(false);
  });

  it("rejects a nonce that is a prefix of the expected one", () => {
    expect(verifyIdTokenNonce(idTokenWith({ nonce: NONCE.slice(0, -1) }), NONCE)).toBe(false);
  });

  it("does not confuse a non-string nonce claim for a match", () => {
    expect(extractNonceFromIdToken(idTokenWith({ nonce: 12345 }))).toBeNull();
    expect(verifyIdTokenNonce(idTokenWith({ nonce: 12345 }), NONCE)).toBe(false);
  });
});

// --- The route --------------------------------------------------------------

describe("GET /api/auth/callback nonce enforcement", () => {
  it("completes the login when the nonce matches", async () => {
    exchangeTokenMock.mockResolvedValue(tokenResponse(NONCE));

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://www.elxea.com/ja/account");
    const setCookie = response.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("shop_at=");
    expect(setCookie).toContain("shop_cid=");
  });

  it("rejects the login when the nonce does not match", async () => {
    exchangeTokenMock.mockResolvedValue(tokenResponse("attacker-controlled-nonce"));

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(response.headers.get("location")).toBe(
      "https://www.elxea.com/ja/account?error=invalid_nonce",
    );
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Shopify id_token nonce verification failed",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("establishes no session at all on a nonce mismatch", async () => {
    exchangeTokenMock.mockResolvedValue(tokenResponse("attacker-controlled-nonce"));

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
    exchangeTokenMock.mockResolvedValue(tokenResponse("attacker-controlled-nonce"));

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    const setCookie = response.headers.getSetCookie().join("\n");
    for (const name of ["shop_cv", "shop_state", "shop_nonce", "shop_return_to"]) {
      expect(setCookie).toContain(`${name}=;`);
    }
  });

  it("rejects a token with no nonce claim", async () => {
    exchangeTokenMock.mockResolvedValue(tokenResponse(undefined));

    const response = await GET(callbackRequest(HAPPY_COOKIES));

    expect(response.headers.get("location")).toContain("error=invalid_nonce");
  });

  it("rejects when the browser presents no shop_nonce cookie", async () => {
    exchangeTokenMock.mockResolvedValue(tokenResponse(NONCE));
    const { shop_nonce: _dropped, ...withoutNonce } = HAPPY_COOKIES;

    const response = await GET(callbackRequest(withoutNonce));

    expect(response.headers.get("location")).toContain("error=invalid_nonce");
  });

  it("still rejects a bad state before the token exchange is attempted", async () => {
    const response = await GET(
      callbackRequest({ ...HAPPY_COOKIES, shop_state: "a-different-state" }),
    );

    expect(response.headers.get("location")).toContain("error=invalid_state");
    expect(exchangeTokenMock).not.toHaveBeenCalled();
  });
});
