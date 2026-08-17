/**
 * T6 — the two `prompt` decisions, pinned together in one file on purpose.
 *
 * They point in opposite directions and are easy to confuse:
 *
 *  - LINE must NOT send `prompt`. `prompt=consent` forces the consent screen
 *    even when the user has already granted every scope, so returning users were
 *    re-consenting on every login. The code comment justified it as needed "for a
 *    fresh token exchange", which is not true — the exchange rests on
 *    `code` + `state` + `code_verifier`.
 *  - Shopify MUST send `prompt=login`. Without it the Shopify SSO cookie silently
 *    re-authenticates the previous user, so a shared device cannot switch
 *    accounts. It is also the backstop for the one residual risk in the logout
 *    fix: if our `shop_it` cannot be decrypted we skip Shopify's RP-initiated
 *    logout, leaving Shopify's SSO cookie in place — and `prompt=login` forces
 *    re-authentication anyway.
 *
 * Asserting them in the same file is the point: someone deleting the LINE
 * `prompt` must see, in the same breath, that the Shopify one is load-bearing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const cookieStore = {
  get: vi.fn(() => undefined),
  set: vi.fn(),
  delete: vi.fn(),
  has: vi.fn(() => false),
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const SAVED = {
  AUTH_LINE_ID: process.env.AUTH_LINE_ID,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  LINE_ALLOWED_CALLBACK_HOSTS: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_LINE_ID = "test-channel-id";
  process.env.NEXTAUTH_URL = "https://www.elxea.com";
  delete process.env.LINE_ALLOWED_CALLBACK_HOSTS;
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function request(url: string) {
  return new NextRequest(url, { headers: { host: "www.elxea.com" } });
}

describe("LINE authorize URL carries no prompt", () => {
  it("POST /api/line-login/init", async () => {
    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(request("https://www.elxea.com/api/line-login/init"));
    const { authUrl } = (await res.json()) as { authUrl: string };

    const url = new URL(authUrl);
    expect(url.host).toBe("access.line.me");
    expect(url.searchParams.has("prompt")).toBe(false);
    // The parameters that DO carry the flow must still be there.
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("scope")).toBe("profile openid email");
  });

  it("GET /api/line-login (legacy redirect route)", async () => {
    const { GET } = await import("@/app/api/line-login/route");
    const res = await GET(request("https://www.elxea.com/api/line-login"));

    const url = new URL(res.headers.get("location")!);
    expect(url.host).toBe("access.line.me");
    expect(url.searchParams.has("prompt")).toBe(false);
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});

describe("Shopify authorize URL keeps prompt=login", () => {
  it("GET /api/auth/login", async () => {
    const { GET } = await import("@/app/api/auth/login/route");
    const res = await GET(request("https://www.elxea.com/api/auth/login?locale=ja"));

    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("both state cookies are issued through the same scope rule", () => {
  it("init and the legacy route agree on the line_oauth_state scope", async () => {
    const { POST } = await import("@/app/api/line-login/init/route");
    await POST(request("https://www.elxea.com/api/line-login/init"));
    const fromInit = cookieStore.set.mock.calls.at(-1);

    cookieStore.set.mockClear();

    const { GET } = await import("@/app/api/line-login/route");
    await GET(request("https://www.elxea.com/api/line-login"));
    const fromLegacy = cookieStore.set.mock.calls.at(-1);

    /* These two routes used to disagree: init scoped the state cookie to the
     * apex while the legacy route set it host-only, so a state issued by one
     * was invisible to a callback that expected the other. Compare the options,
     * not the random state value. */
    const optionsOf = (call: unknown[] | undefined) => {
      const opts = (call?.[2] ?? {}) as Record<string, unknown>;
      return { domain: opts.domain, path: opts.path, secure: opts.secure, httpOnly: opts.httpOnly };
    };

    expect(fromInit?.[0]).toBe("line_oauth_state");
    expect(fromLegacy?.[0]).toBe("line_oauth_state");
    expect(optionsOf(fromLegacy)).toEqual(optionsOf(fromInit));
    expect(optionsOf(fromInit).domain).toBe(".elxea.com");
  });
});

describe("an untrusted host is refused rather than sent to production (symptom 3)", () => {
  /* `NEXTAUTH_URL` is unset in preview while Vercel injects
   * `VERCEL_PROJECT_PRODUCTION_URL` into every environment, so `getBaseUrl()`
   * resolved to the PRODUCTION origin on a preview deployment and the LINE round
   * trip delivered the user to the production top page. Refusing is the correct
   * outcome; silently switching deployments is not. */
  it.each([
    "preview-abc.vercel.app",
    "elxea-web-app-git-feat-x.vercel.app",
    "evil.example",
    "evil-elxea.com",
  ])("POST /api/line-login/init on %s returns 503", async (host) => {
    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(
      new NextRequest("https://internal.example/api/line-login/init", { headers: { host } }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("auth_host_not_registered");
  });

  it.each(["www.elxea.com", "elxea.com", "WWW.ELXEA.COM:443"])(
    "still serves our own host %s",
    async (host) => {
      const { POST } = await import("@/app/api/line-login/init/route");
      const res = await POST(
        new NextRequest("https://www.elxea.com/api/line-login/init", { headers: { host } }),
      );
      expect(res.status).toBe(200);
      expect(new URL((await res.json()).authUrl).host).toBe("access.line.me");
    },
  );

  it("GET /api/auth/login on an untrusted host returns 503", async () => {
    const { GET } = await import("@/app/api/auth/login/route");
    const res = await GET(
      new NextRequest("https://internal.example/api/auth/login?locale=ja", {
        headers: { host: "preview-abc.vercel.app" },
      }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("auth_host_not_registered");
  });
});

describe("unconfigured LINE channel fails closed with 503", () => {
  it("returns 503 auth_not_configured rather than 500", async () => {
    delete process.env.AUTH_LINE_ID;
    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(request("https://www.elxea.com/api/line-login/init"));

    /* 503, not 500: the channel is not misbehaving, it is not configured for this
     * deployment. The login button reads this to stay disabled with a specific
     * reason instead of offering a control that cannot work. */
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "auth_not_configured" });
  });
});
