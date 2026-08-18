/**
 * Tests for GET /api/auth/logout (defect 1).
 *
 * The contract this route must hold:
 *   1. With a decryptable `shop_it`, go to Shopify's RP-initiated logout and
 *      ALWAYS carry `id_token_hint` (omitting it is a 400 from Shopify — the
 *      original defect).
 *   2. With no `shop_it`, do NOT leave the site. A LINE-only user has no Shopify
 *      session to end, and sending them to Shopify shows them a 400.
 *   3. With a `shop_it` we cannot decrypt, also do not leave the site, and make
 *      that state observable (Sentry) instead of folding it into case 2.
 *   4. With an unregistered request host, do not leave the site: Shopify matches
 *      `post_logout_redirect_uri` against a registered list by exact string.
 *   5. Auth cookies are cleared on the response in every branch.
 *
 * `decryptToken` and Sentry are mocked; no real crypto or network is involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const decryptTokenMock = vi.fn();
vi.mock("@/lib/shopify/customer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/shopify/customer")>(
    "@/lib/shopify/customer",
  );
  return {
    ...actual,
    decryptToken: (...args: unknown[]) => decryptTokenMock(...args),
  };
});

const captureMessageMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { GET } from "@/app/api/auth/logout/route";

const AUTH_COOKIES = [
  "shop_at",
  "shop_rt",
  "shop_exp",
  "shop_auth",
  "shop_cid",
  "shop_it",
  "line_user",
  "line_session",
  "line_auth",
  "line_uid",
] as const;

const SAVED = {
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  LINE_ALLOWED_CALLBACK_HOSTS: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
  SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL: process.env.SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://www.elxea.com";
  process.env.LINE_ALLOWED_CALLBACK_HOSTS = "www.elxea.com";
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/**
 * Production-shaped request: Vercel terminates TLS and forwards
 * `x-forwarded-proto: https`, so that is what the scheme is derived from. A
 * plain-http local request is covered separately below.
 */
function makeRequest(opts: { host?: string; cookie?: string; locale?: string } = {}) {
  const headers: Record<string, string> = {
    host: opts.host ?? "www.elxea.com",
    "x-forwarded-proto": "https",
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  return new NextRequest(
    `https://www.elxea.com/api/auth/logout?locale=${opts.locale ?? "ja"}`,
    { headers },
  );
}

function location(res: Response): string {
  return res.headers.get("location") ?? "";
}

describe("GET /api/auth/logout", () => {
  it("goes to Shopify WITH id_token_hint when shop_it decrypts", async () => {
    decryptTokenMock.mockReturnValue("decrypted-id-token");
    const res = await GET(makeRequest({ cookie: "shop_it=ciphertext" }));

    const url = new URL(location(res));
    expect(url.pathname).toMatch(/\/authentication\/(\d+\/)?logout$/);
    expect(url.searchParams.get("id_token_hint")).toBe("decrypted-id-token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://www.elxea.com/ja");
    // Origin comes from the request, exactly as before this change.
  });

  it("stays on-site when there is no shop_it (the LINE-only user case)", async () => {
    const res = await GET(makeRequest());

    expect(location(res)).toBe("https://www.elxea.com/ja");
    expect(decryptTokenMock).not.toHaveBeenCalled();
  });

  it("stays on-site when shop_it cannot be decrypted, and reports it", async () => {
    decryptTokenMock.mockReturnValue(null);
    const res = await GET(makeRequest({ cookie: "shop_it=corrupted" }));

    expect(location(res)).toBe("https://www.elxea.com/ja");
    expect(captureMessageMock).toHaveBeenCalledTimes(1);

    /* The decrypt-failure signal must be distinguishable from "no cookie", which
     * is the whole point of not writing `?? undefined`. */
    const [message, context] = captureMessageMock.mock.calls[0] as [
      string,
      { extra?: Record<string, unknown> },
    ];
    expect(message).toMatch(/could not be decrypted/);
    expect(context.extra?.reason).toBe("decrypt_failed");

    /* It must not leak the token material, only its shape. */
    expect(JSON.stringify(context)).not.toContain("corrupted");
  });

  it("does not report anything when there is simply no cookie", async () => {
    await GET(makeRequest());
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("stays on-site when the request host is not registered", async () => {
    decryptTokenMock.mockReturnValue("decrypted-id-token");
    const req = new NextRequest("https://preview-abc.vercel.app/api/auth/logout?locale=ja", {
      headers: {
        host: "preview-abc.vercel.app",
        "x-forwarded-proto": "https",
        cookie: "shop_it=ciphertext",
      },
    });
    const res = await GET(req);

    /* Completes locally on the origin the user is actually on, rather than
     * handing Shopify a host it has not been told about. */
    expect(location(res)).toBe("https://preview-abc.vercel.app/ja");
    expect(location(res)).not.toContain("authentication");
  });

  it("still reaches Shopify when the host gate is not configured at all", async () => {
    delete process.env.LINE_ALLOWED_CALLBACK_HOSTS;
    decryptTokenMock.mockReturnValue("decrypted-id-token");
    const res = await GET(
      makeRequest({ host: "preview-abc.vercel.app", cookie: "shop_it=ciphertext" }),
    );

    // Fail-open: introducing the gate must not change behaviour until it is set.
    expect(new URL(location(res)).searchParams.get("id_token_hint")).toBe("decrypted-id-token");
  });

  it("honours the locale parameter and defaults to ja", async () => {
    const en = await GET(makeRequest({ locale: "en" }));
    expect(location(en)).toBe("https://www.elxea.com/en");

    const noLocale = new NextRequest("https://www.elxea.com/api/auth/logout", {
      headers: { host: "www.elxea.com", "x-forwarded-proto": "https" },
    });
    expect(location(await GET(noLocale))).toBe("https://www.elxea.com/ja");
  });

  it("uses the origin the request arrived on (local http stays http)", async () => {
    process.env.LINE_ALLOWED_CALLBACK_HOSTS = "www.elxea.test";
    const req = new NextRequest("http://www.elxea.test:3310/api/auth/logout?locale=ja", {
      headers: { host: "www.elxea.test:3310" },
    });
    expect(location(await GET(req))).toBe("http://www.elxea.test:3310/ja");
  });

  it.each([
    ["with a Shopify session", "shop_it=ciphertext", "decrypted-id-token"],
    ["without one", undefined, null],
  ])("clears every auth cookie %s", async (_label, cookie, decrypted) => {
    decryptTokenMock.mockReturnValue(decrypted);
    const res = await GET(makeRequest(cookie ? { cookie } : {}));

    const setCookie = res.headers.getSetCookie().join("\n");
    for (const name of AUTH_COOKIES) {
      expect(setCookie, `${name} must be cleared`).toContain(`${name}=;`);
    }
  });
});
