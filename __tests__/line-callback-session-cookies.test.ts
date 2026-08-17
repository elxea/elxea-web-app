/**
 * The LINE callback must actually log the user in.
 *
 * This is the test whose absence let a login outage ship inside a logout fix.
 * `__tests__/auth-cookie-clear-parity.test.ts` checks issuing and clearing
 * against each other, but it SYNTHESISES the issued side by calling
 * `cookieOptionsFor` directly. That models the rule, not the route — and the bug
 * lived in the interaction between them: `/api/line-callback` issues four
 * Domain-scoped session cookies and then clears the state cookie on the same
 * response, and the clear was destroying all four on the way out.
 *
 * So this file drives the real route handler and inspects the real response. The
 * population under test is "what a browser would receive", not "what the helper
 * returns".
 *
 * Only the network is mocked: LINE's token / profile / verify endpoints and the
 * cx-agent identity link. Cookie handling, the response object and the clearing
 * path are all the real thing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const STATE = "state-value-for-test";

const cookieStore = {
  get: vi.fn((name: string) =>
    name === "line_oauth_state" ? { name, value: STATE } : undefined,
  ),
  set: vi.fn(),
  delete: vi.fn(),
  has: vi.fn(() => false),
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const LINE_SESSION_COOKIES = ["line_user", "line_auth", "line_uid", "line_session"] as const;

const SAVED = {
  AUTH_LINE_ID: process.env.AUTH_LINE_ID,
  AUTH_LINE_SECRET: process.env.AUTH_LINE_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  SYNC_API_SECRET: process.env.SYNC_API_SECRET,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_LINE_ID = "test-channel";
  process.env.AUTH_LINE_SECRET = "test-secret";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://www.elxea.com";

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2/v2.1/token")) {
        return new Response(
          JSON.stringify({ access_token: "at", id_token: "idt", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("v2/profile")) {
        return new Response(
          JSON.stringify({ userId: "U-test-user", displayName: "テスト太郎" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("oauth2/v2.1/verify")) {
        return new Response(JSON.stringify({ email: "t@example.com" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // cx-agent identity link
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

type Directive = { name: string; value: string; domain?: string; expired: boolean };

function parse(raw: string): Directive {
  const [nameValue, ...attrs] = raw.split(";").map((s) => s.trim());
  const eq = nameValue.indexOf("=");
  const d: Directive = {
    name: nameValue.slice(0, eq),
    value: nameValue.slice(eq + 1),
    expired: false,
  };
  for (const attr of attrs) {
    const [k, v] = attr.split("=");
    if (k.toLowerCase() === "domain") d.domain = v?.toLowerCase();
    if (k.toLowerCase() === "max-age" && Number(v) <= 0) d.expired = true;
  }
  return d;
}

async function callCallback(host = "www.elxea.com") {
  const { GET } = await import("@/app/api/line-callback/route");
  const req = new NextRequest(
    `https://${host}/api/line-callback?code=abc&state=${STATE}`,
    { headers: { host, "x-forwarded-proto": "https" } },
  );
  const res = await GET(req);
  return { res, directives: res.headers.getSetCookie().map(parse) };
}

describe("GET /api/line-callback issues a usable session", () => {
  it("delivers all four LINE session cookies with a real value", async () => {
    const { directives } = await callCallback();

    for (const name of LINE_SESSION_COOKIES) {
      const issued = directives.filter((d) => d.name === name && !d.expired && d.value !== "");
      expect(
        issued.length,
        `${name} must be delivered with a value — the user is not logged in otherwise`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("scopes those cookies to the apex so elxea.com and www share one session", async () => {
    const { directives } = await callCallback();

    for (const name of LINE_SESSION_COOKIES) {
      const issued = directives.find((d) => d.name === name && !d.expired && d.value !== "");
      expect(issued?.domain, `${name} must be apex-scoped`).toBe(".elxea.com");
    }
  });

  it("expires the one-shot state cookie at BOTH scopes on the same response", async () => {
    const { directives } = await callCallback();

    const state = directives.filter((d) => d.name === "line_oauth_state" && d.expired);
    expect(state.map((d) => d.domain ?? "(host-only)").sort()).toEqual([
      "(host-only)",
      ".elxea.com",
    ]);
  });

  it("does not expire any session cookie it just issued", async () => {
    /* The regression, stated directly. The clearing helper used to drop every
     * `Domain=.elxea.com` line on the response before re-appending its own, which
     * matched the session cookies issued moments earlier and deleted them. */
    const { directives } = await callCallback();

    for (const name of LINE_SESSION_COOKIES) {
      const expired = directives.filter((d) => d.name === name && d.expired);
      expect(expired, `${name} must not be expired by the state-cookie clear`).toEqual([]);
    }
  });

  it("redirects to the login-complete page", async () => {
    const { res } = await callCallback();
    expect(res.headers.get("location")).toContain("/login/complete");
  });

  it("works on the apex host too", async () => {
    const { directives } = await callCallback("elxea.com");
    const session = directives.filter(
      (d) => LINE_SESSION_COOKIES.includes(d.name as never) && !d.expired && d.value !== "",
    );
    expect(session).toHaveLength(4);
    expect(session.every((d) => d.domain === ".elxea.com")).toBe(true);
  });

  it("issues host-only cookies on a non-apex host, and still clears state", async () => {
    const { directives } = await callCallback("preview-abc.vercel.app");

    const session = directives.filter(
      (d) => LINE_SESSION_COOKIES.includes(d.name as never) && !d.expired && d.value !== "",
    );
    expect(session).toHaveLength(4);
    expect(session.every((d) => d.domain === undefined)).toBe(true);

    const state = directives.filter((d) => d.name === "line_oauth_state" && d.expired);
    expect(state.length).toBeGreaterThanOrEqual(1);
  });
});
