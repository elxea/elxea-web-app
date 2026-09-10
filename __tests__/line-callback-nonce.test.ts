/**
 * The LINE Login callback must refuse an id_token it cannot tie to this login.
 *
 * ## What was wrong (D11)
 *
 * `/api/line-callback` asked LINE to verify the id_token and then used the answer
 * for exactly one thing: reading `email`. Any failure — non-200, a thrown fetch,
 * a payload for a different channel — fell through with `email = null` and the
 * login completed anyway. The verification was decorative: a token that failed
 * every check produced the same session as one that passed.
 *
 * And no `nonce` was sent at authorize time or checked on return, so nothing tied
 * the returned token to the request we made (OIDC Core §3.1.3.7 step 11). `state`
 * only says the *authorization response* came back to this browser.
 *
 * ## What is pinned here
 *
 * Each case below is a token that a broken implementation would have accepted.
 * The assertion is always the same: no session, and the user is sent back to the
 * login screen. Session-cookie shape on the SUCCESS path is covered by
 * `line-callback-session-cookies.test.ts`; this file is only about the gate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const STATE = "state-value-for-test";
const NONCE = "nonce-value-for-test";
const LINE_USER_ID = "U0123456789abcdef0123456789abcdef";
const CHANNEL_ID = "test-channel";

/** Cookies the browser presents on return. Tests override one field at a time. */
let presentedCookies: Record<string, string> = {};

const cookieStore = {
  get: vi.fn((name: string) =>
    presentedCookies[name] === undefined ? undefined : { name, value: presentedCookies[name] },
  ),
  set: vi.fn(),
  delete: vi.fn(),
  has: vi.fn(() => false),
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const LINE_SESSION_COOKIES = ["line_user", "line_auth", "line_uid", "line_session"] as const;

/** The verify payload for a token that should be accepted. */
function goodVerifyPayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: LINE_USER_ID,
    aud: CHANNEL_ID,
    iss: "https://access.line.me",
    exp: Math.floor(Date.now() / 1000) + 3600,
    nonce: NONCE,
    email: "t@example.com",
    ...overrides,
  };
}

type Scenario = {
  /** Replaces the verify endpoint's response. */
  verify?: () => Response;
  /** Replaces the profile endpoint's payload. */
  profileUserId?: string;
};

function stubLineApi(scenario: Scenario = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2/v2.1/token")) {
        return Response.json({ access_token: "at", id_token: "idt", expires_in: 3600 });
      }
      if (url.includes("v2/profile")) {
        return Response.json({
          userId: scenario.profileUserId ?? LINE_USER_ID,
          displayName: "テスト太郎",
        });
      }
      if (url.includes("oauth2/v2.1/verify")) {
        return scenario.verify ? scenario.verify() : Response.json(goodVerifyPayload());
      }
      return new Response("{}", { status: 200 }); // cx-agent identity link
    }),
  );
}

const SAVED = {
  AUTH_LINE_ID: process.env.AUTH_LINE_ID,
  AUTH_LINE_SECRET: process.env.AUTH_LINE_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
};

beforeEach(() => {
  vi.clearAllMocks();
  presentedCookies = { line_oauth_state: STATE, line_oauth_nonce: NONCE };
  process.env.AUTH_LINE_ID = CHANNEL_ID;
  process.env.AUTH_LINE_SECRET = "test-secret";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://www.elxea.com";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stubLineApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function callCallback() {
  const { GET } = await import("@/app/api/line-callback/route");
  const req = new NextRequest(
    `https://www.elxea.com/api/line-callback?code=abc&state=${STATE}`,
    { headers: { host: "www.elxea.com", "x-forwarded-proto": "https" } },
  );
  return GET(req);
}

/** No session cookie carrying a value may appear on a rejected response. */
function expectNoSession(response: Awaited<ReturnType<typeof callCallback>>) {
  const directives = response.headers.getSetCookie();
  for (const name of LINE_SESSION_COOKIES) {
    const issued = directives.filter((d) => d.startsWith(`${name}=`) && !d.startsWith(`${name}=;`));
    expect(issued, `${name} must not be issued on a rejected login`).toHaveLength(0);
  }
}

describe("GET /api/line-callback rejects an unbindable id_token", () => {
  it("accepts the login when everything checks out", async () => {
    /* The control. Without it, every assertion below could be satisfied by a
     * route that rejects unconditionally. */
    const response = await callCallback();
    expect(response.headers.get("location")).toContain("/login/complete");
  });

  it("rejects a token minted for a different authorization request", async () => {
    stubLineApi({ verify: () => Response.json(goodVerifyPayload({ nonce: "another-nonce" })) });

    const response = await callCallback();

    expect(response.headers.get("location")).toContain("error=InvalidIdToken");
    expectNoSession(response);
  });

  it("rejects a token that carries no nonce at all", async () => {
    const payload = goodVerifyPayload();
    delete (payload as Record<string, unknown>).nonce;
    stubLineApi({ verify: () => Response.json(payload) });

    const response = await callCallback();

    expect(response.headers.get("location")).toContain("error=InvalidIdToken");
    expectNoSession(response);
  });

  it("rejects when the browser presents no nonce cookie", async () => {
    /* Fail-closed on a missing cookie. Treating "no cookie" as "no check needed"
     * would let an attacker disable the check by simply not sending one. */
    delete presentedCookies.line_oauth_nonce;

    const response = await callCallback();

    expect(response.headers.get("location")).toContain("error=InvalidIdToken");
    expectNoSession(response);
  });

  it("rejects when LINE says the token is invalid, instead of logging in anyway", async () => {
    /* The exact regression: a 400 from verify used to be swallowed and the login
     * continued with `email = null`. */
    stubLineApi({ verify: () => new Response("bad token", { status: 400 }) });

    const response = await callCallback();

    expect(response.headers.get("location")).toContain("error=InvalidIdToken");
    expectNoSession(response);
  });

  it("rejects a token issued for another channel", async () => {
    stubLineApi({ verify: () => Response.json(goodVerifyPayload({ aud: "9999999999" })) });

    const response = await callCallback();

    expect(response.headers.get("location")).toContain("error=InvalidIdToken");
    expectNoSession(response);
  });

  it("rejects an expired token", async () => {
    stubLineApi({
      verify: () => Response.json(goodVerifyPayload({ exp: Math.floor(Date.now() / 1000) - 3600 })),
    });

    const response = await callCallback();

    expect(response.headers.get("location")).toContain("error=InvalidIdToken");
    expectNoSession(response);
  });

  it("rejects when the profile userId and the id_token sub disagree", async () => {
    /* Two independent responses describing the same person. If they disagree, one
     * of them does not belong to this exchange — which is the confusion an
     * attacker would have to engineer. */
    stubLineApi({ profileUserId: "Ufedcba9876543210fedcba9876543210" });

    const response = await callCallback();

    expect(response.headers.get("location")).toContain("error=InvalidIdToken");
    expectNoSession(response);
  });

  it("expires both one-shot flow cookies on a rejected attempt", async () => {
    /* Leaving the nonce behind would let a later attempt be compared against a
     * value from an abandoned round trip. */
    stubLineApi({ verify: () => Response.json(goodVerifyPayload({ nonce: "another-nonce" })) });

    const response = await callCallback();

    const directives = response.headers.getSetCookie().join("\n");
    expect(directives).toContain("line_oauth_state=;");
    expect(directives).toContain("line_oauth_nonce=;");
  });
});
