import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getBaseUrl,
  getRequestHostname,
  getRequestOrigin,
  isRegisteredAuthHost,
  isTrustedAuthHost,
} from "@/lib/base-url";
import { normalizeHost } from "@/lib/auth/normalize-host";
import { NextRequest } from "next/server";

/**
 * T4 — origin resolution and host handling.
 *
 * The load-bearing property is NEGATIVE: adding a request parameter to
 * `getBaseUrl` must not change what it returns for any env combination when no
 * request is supplied, or when the request host is not registered. This is a
 * change to production login, so "identical unless deliberately enabled" is
 * checked exhaustively rather than sampled.
 *
 * The reference implementation below is a verbatim transcription of the
 * pre-change `lib/base-url.ts`. It is duplicated on purpose: importing the real
 * one would make the test tautological.
 */

const ENV_KEYS = [
  "NEXTAUTH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_ENV",
  "LINE_ALLOWED_CALLBACK_HOSTS",
  "NODE_ENV",
] as const;

type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

let saved: EnvSnapshot = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = saved[k];
  }
});

/* `process.env.NODE_ENV` is typed readonly by @types/node, but these tests must
 * drive the production branch of getBaseUrl(), which reads it. Writing through a
 * mutable view keeps the cast in one place instead of at every assignment. */
const mutableEnv = process.env as Record<string, string | undefined>;

function setEnv(env: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) delete mutableEnv[k];
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) mutableEnv[k] = v;
  }
}

/** Verbatim transcription of the original env-only implementation. */
function referenceGetBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing base URL: set NEXTAUTH_URL, VERCEL_PROJECT_PRODUCTION_URL, or VERCEL_URL in production"
    );
  }
  return "http://localhost:3000";
}

/** Minimal NextRequest stand-in: only headers and nextUrl.protocol are read. */
function fakeRequest(
  headers: Record<string, string | undefined>,
  protocol = "http:",
): Parameters<typeof getBaseUrl>[0] {
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) lower.set(k.toLowerCase(), v);
  }
  return {
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    nextUrl: { protocol },
  } as unknown as Parameters<typeof getBaseUrl>[0];
}

function outcome(fn: () => string): { ok: true; value: string } | { ok: false; message: string } {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

describe("getBaseUrl() — no request: exhaustive parity with the previous implementation", () => {
  const values: Record<string, Array<string | undefined>> = {
    NEXTAUTH_URL: [undefined, "https://www.elxea.com"],
    VERCEL_PROJECT_PRODUCTION_URL: [undefined, "prod.example.com"],
    VERCEL_URL: [undefined, "preview-abc.vercel.app"],
    NODE_ENV: ["test", "development", "production"],
    /* Added 2026-08-18 with the preview-origin fix. `VERCEL_ENV` is the switch
     * the new code reads, so it is swept here too — with the two values that
     * are NOT "preview". Parity across both is the machine-checked form of "the
     * production result does not change by a single character". */
    VERCEL_ENV: [undefined, "production"],
  };

  // 2 * 2 * 2 * 3 * 2 = 48 combinations. Every one is compared, not sampled:
  // this is the "no unnoticed behaviour change" claim, so a gap in coverage is
  // a gap in the claim.
  const combos: Array<Record<string, string | undefined>> = [];
  for (const a of values.NEXTAUTH_URL)
    for (const b of values.VERCEL_PROJECT_PRODUCTION_URL)
      for (const c of values.VERCEL_URL)
        for (const d of values.NODE_ENV)
          for (const e of values.VERCEL_ENV)
            combos.push({
              NEXTAUTH_URL: a,
              VERCEL_PROJECT_PRODUCTION_URL: b,
              VERCEL_URL: c,
              NODE_ENV: d,
              VERCEL_ENV: e,
            });

  it("covers 48 env combinations", () => {
    expect(combos).toHaveLength(48);
  });

  for (const combo of combos) {
    const label = ENV_KEYS.filter((k) => k in combo)
      .map((k) => `${k}=${combo[k] ?? "unset"}`)
      .join(" ");

    it(`matches for ${label}`, () => {
      setEnv(combo);
      const expected = outcome(referenceGetBaseUrl);
      setEnv(combo);
      const actual = outcome(() => getBaseUrl());
      expect(actual).toEqual(expected);
    });
  }

  it("throws when all three env vars are unset in production (gate 10)", () => {
    setEnv({ NODE_ENV: "production" });
    expect(() => getBaseUrl()).toThrow(/Missing base URL/);
  });

  it("falls back to localhost:3000 outside production", () => {
    setEnv({ NODE_ENV: "development" });
    expect(getBaseUrl()).toBe("http://localhost:3000");
  });
});

describe("getBaseUrl(request) — the request origin is gated, not preferred", () => {
  it("ignores the request entirely when LINE_ALLOWED_CALLBACK_HOSTS is unset", () => {
    setEnv({ NEXTAUTH_URL: "https://www.elxea.com", NODE_ENV: "test" });
    const req = fakeRequest({ host: "www.elxea.com:443" });
    expect(getBaseUrl(req)).toBe("https://www.elxea.com");
  });

  it("still throws in production with the env unset, even with a request", () => {
    setEnv({ NODE_ENV: "production" });
    const req = fakeRequest({ host: "www.elxea.com" });
    expect(() => getBaseUrl(req)).toThrow(/Missing base URL/);
  });

  it("uses the request origin when the host is registered", () => {
    setEnv({
      NEXTAUTH_URL: "https://www.elxea.com",
      LINE_ALLOWED_CALLBACK_HOSTS: "www.elxea.test",
      NODE_ENV: "test",
    });
    const req = fakeRequest({ host: "www.elxea.test:3310" }, "http:");
    expect(getBaseUrl(req)).toBe("http://www.elxea.test:3310");
  });

  it("falls back to env when the host is NOT registered", () => {
    setEnv({
      NEXTAUTH_URL: "https://www.elxea.com",
      LINE_ALLOWED_CALLBACK_HOSTS: "www.elxea.com",
      NODE_ENV: "test",
    });
    const req = fakeRequest({ host: "preview-abc.vercel.app" });
    expect(getBaseUrl(req)).toBe("https://www.elxea.com");
  });

  it("prefers Host over a spoofed X-Forwarded-Host", () => {
    setEnv({
      NEXTAUTH_URL: "https://www.elxea.com",
      LINE_ALLOWED_CALLBACK_HOSTS: "www.elxea.test,attacker.example.com",
      NODE_ENV: "test",
    });
    const req = fakeRequest({
      host: "www.elxea.test:3310",
      "x-forwarded-host": "attacker.example.com",
    });
    expect(getBaseUrl(req)).toBe("http://www.elxea.test:3310");
  });

  it("uses x-forwarded-host only when Host is absent", () => {
    setEnv({
      NEXTAUTH_URL: "https://www.elxea.com",
      LINE_ALLOWED_CALLBACK_HOSTS: "fallback.elxea.test",
      NODE_ENV: "test",
    });
    const req = fakeRequest({ "x-forwarded-host": "fallback.elxea.test" });
    expect(getBaseUrl(req)).toBe("http://fallback.elxea.test");
  });

  it("honours x-forwarded-proto over the server's own scheme", () => {
    setEnv({
      NEXTAUTH_URL: "https://www.elxea.com",
      LINE_ALLOWED_CALLBACK_HOSTS: "www.elxea.com",
      NODE_ENV: "test",
    });
    const req = fakeRequest(
      { host: "www.elxea.com", "x-forwarded-proto": "https" },
      "http:",
    );
    expect(getBaseUrl(req)).toBe("https://www.elxea.com");
  });

  it("returns env when the Host header is empty", () => {
    setEnv({
      NEXTAUTH_URL: "https://www.elxea.com",
      LINE_ALLOWED_CALLBACK_HOSTS: "www.elxea.com",
      NODE_ENV: "test",
    });
    expect(getBaseUrl(fakeRequest({ host: "" }))).toBe("https://www.elxea.com");
  });
});

describe("isRegisteredAuthHost", () => {
  it("is true when the env var is unset (must not take production down)", () => {
    setEnv({ NODE_ENV: "test" });
    expect(isRegisteredAuthHost("anything.example.com")).toBe(true);
  });

  it("is true when the env var is set but lists nothing usable", () => {
    setEnv({ LINE_ALLOWED_CALLBACK_HOSTS: " , ,", NODE_ENV: "test" });
    expect(isRegisteredAuthHost("anything.example.com")).toBe(true);
  });

  it.each([
    ["www.elxea.com", true],
    ["WWW.ELXEA.COM", true],
    ["www.elxea.com.", true],
    ["www.elxea.com:443", true],
    ["elxea.com", true],
    ["attacker.example.com", false],
    ["evil-www.elxea.com", false],
    ["", false],
  ])("normalises %s before comparing -> %s", (host, expected) => {
    setEnv({ LINE_ALLOWED_CALLBACK_HOSTS: "www.elxea.com, elxea.com", NODE_ENV: "test" });
    expect(isRegisteredAuthHost(host)).toBe(expected);
  });

  it("normalises the configured list too, not just the input", () => {
    setEnv({ LINE_ALLOWED_CALLBACK_HOSTS: " WWW.ELXEA.COM. , ELXEA.COM:443 ", NODE_ENV: "test" });
    expect(isRegisteredAuthHost("www.elxea.com")).toBe(true);
    expect(isRegisteredAuthHost("elxea.com")).toBe(true);
  });
});

describe("getRequestOrigin — the Shopify-family routes keep their previous origin", () => {
  /* These four routes previously computed
   * `process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin`, and that
   * variable is not set in production (verified 2026-08-18 by listing variable
   * names only, no values read). So the behaviour to preserve is exactly
   * `request.nextUrl.origin`, independent of every env var. */
  it.each([
    ["https://www.elxea.com/api/auth/login", "https://www.elxea.com"],
    ["https://elxea.com/api/auth/login", "https://elxea.com"],
    ["https://preview-abc.vercel.app/api/auth/callback", "https://preview-abc.vercel.app"],
  ])("%s -> %s", (url, expected) => {
    setEnv({ NODE_ENV: "test" });
    const req = new NextRequest(url);
    expect(getRequestOrigin(req)).toBe(expected);
  });

  describe("a spoofed Host cannot steer the redirect (fail-closed)", () => {
    /* This origin becomes a redirect target on logout's local-completion branch,
     * so trusting the Host header unchecked would be an open redirect. */
    it("ignores an attacker Host and falls back to the server's own origin", () => {
      setEnv({ NODE_ENV: "test" });
      const req = new NextRequest("https://www.elxea.com/api/auth/logout", {
        headers: { host: "evil.example" },
      });
      expect(getRequestOrigin(req)).toBe("https://www.elxea.com");
      expect(getRequestOrigin(req)).not.toContain("evil.example");
    });

    it("ignores a lookalike that merely ends with the apex string", () => {
      setEnv({ NODE_ENV: "test" });
      const req = new NextRequest("https://www.elxea.com/api/auth/logout", {
        headers: { host: "evil-elxea.com" },
      });
      expect(getRequestOrigin(req)).toBe("https://www.elxea.com");
    });

    it("accepts a host under our own apex", () => {
      setEnv({ NODE_ENV: "test" });
      const req = new NextRequest("https://internal.example/api/auth/logout", {
        headers: { host: "www.elxea.com", "x-forwarded-proto": "https" },
      });
      expect(getRequestOrigin(req)).toBe("https://www.elxea.com");
    });

    it("accepts a host the allow-list names, once the allow-list exists", () => {
      setEnv({ LINE_ALLOWED_CALLBACK_HOSTS: "staging.example", NODE_ENV: "test" });
      const req = new NextRequest("https://internal.example/api/auth/logout", {
        headers: { host: "staging.example", "x-forwarded-proto": "https" },
      });
      expect(getRequestOrigin(req)).toBe("https://staging.example");
    });

    it("does NOT accept an arbitrary host just because the allow-list is unset", () => {
      setEnv({ NODE_ENV: "test" });
      const req = new NextRequest("https://internal.example/api/auth/logout", {
        headers: { host: "staging.example", "x-forwarded-proto": "https" },
      });
      expect(getRequestOrigin(req)).toBe("https://internal.example");
    });
  });
});

describe("getRequestHostname", () => {
  it.each([
    ["www.elxea.test:3310", "www.elxea.test"],
    ["WWW.ELXEA.TEST:3310", "www.elxea.test"],
    ["www.elxea.test.:3310", "www.elxea.test"],
    ["www.elxea.test, proxy.internal", "www.elxea.test"],
    ["[::1]:3000", "[::1]"],
    ["", ""],
  ])("%s -> %s", (host, expected) => {
    expect(getRequestHostname(fakeRequest({ host }) as never)).toBe(expected);
  });
});

describe("normalizeHost", () => {
  it.each([
    ["www.elxea.com", "www.elxea.com"],
    ["WWW.ELXEA.COM", "www.elxea.com"],
    ["www.elxea.com.", "www.elxea.com"],
    ["www.elxea.com:443", "www.elxea.com"],
    ["WWW.ELXEA.COM.:443", "www.elxea.com"],
    ["  www.elxea.com  ", "www.elxea.com"],
    ["first.example.com, second.example.com", "first.example.com"],
    ["[::1]:3000", "[::1]"],
    ["[2001:db8::1]", "[2001:db8::1]"],
    ["[malformed", "[malformed"],
    ["", ""],
    [".", ""],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeHost(raw)).toBe(expected);
  });
});

/**
 * Preview deployments must land on themselves.
 *
 * The defect: with `VERCEL_ENV=preview`, `NEXTAUTH_URL` unset (it is set in no
 * environment on this project) and `VERCEL_PROJECT_PRODUCTION_URL` injected by
 * Vercel everywhere, `getBaseUrl()` returned the PRODUCTION origin. The LINE
 * `redirect_uri` built from it delivered the user to the production deployment:
 * old build, no `line_oauth_state` cookie → StateMismatch → `/password`.
 *
 * `PREVIEW_HOST` below is what the previous implementation returned in each of
 * these cases; every `expect` in this block fails against it.
 */
describe("getBaseUrl() — preview deployments resolve to their own origin", () => {
  const DEPLOY_HOST = "elxea-web-app-abc123.vercel.app";
  const BRANCH_HOST = "elxea-web-app-git-fix-auth.vercel.app";
  const PROD_HOST = "www.elxea.com";

  function previewEnv(extra: Record<string, string | undefined> = {}) {
    setEnv({
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: PROD_HOST,
      VERCEL_URL: DEPLOY_HOST,
      VERCEL_BRANCH_URL: BRANCH_HOST,
      NODE_ENV: "production",
      ...extra,
    });
  }

  it("no longer resolves to the production origin with no request", () => {
    previewEnv();
    expect(getBaseUrl()).toBe(`https://${DEPLOY_HOST}`);
    expect(getBaseUrl()).not.toContain(PROD_HOST);
  });

  it("stays on the deployment host the request arrived on", () => {
    previewEnv();
    expect(getBaseUrl(fakeRequest({ host: DEPLOY_HOST }))).toBe(`https://${DEPLOY_HOST}`);
  });

  it("stays on the branch host when that is the one being browsed", () => {
    previewEnv();
    expect(getBaseUrl(fakeRequest({ host: BRANCH_HOST }))).toBe(`https://${BRANCH_HOST}`);
  });

  it("works with LINE_ALLOWED_CALLBACK_HOSTS unset — that is the shipped state", () => {
    previewEnv();
    expect(process.env.LINE_ALLOWED_CALLBACK_HOSTS).toBeUndefined();
    expect(getBaseUrl(fakeRequest({ host: DEPLOY_HOST }))).toBe(`https://${DEPLOY_HOST}`);
  });

  it("treats the platform-assigned preview hosts as trusted auth hosts", () => {
    previewEnv();
    // Without this the init route 503s every preview login (`isTrustedAuthHost`
    // only knew the apex, and *.vercel.app is not under it).
    expect(isTrustedAuthHost(DEPLOY_HOST)).toBe(true);
    expect(isTrustedAuthHost(BRANCH_HOST)).toBe(true);
  });

  describe("untrusted input cannot become a redirect_uri", () => {
    it("ignores a Host header naming a host the platform did not assign", () => {
      previewEnv();
      expect(getBaseUrl(fakeRequest({ host: "attacker.example.com" }))).toBe(
        `https://${DEPLOY_HOST}`,
      );
    });

    it("ignores a spoofed X-Forwarded-Host", () => {
      previewEnv();
      const req = fakeRequest({
        host: DEPLOY_HOST,
        "x-forwarded-host": "attacker.example.com",
      });
      expect(getBaseUrl(req)).toBe(`https://${DEPLOY_HOST}`);
    });

    it("does not trust an arbitrary host even on a preview", () => {
      previewEnv();
      expect(isTrustedAuthHost("attacker.example.com")).toBe(false);
      expect(isTrustedAuthHost("elxea-web-app-abc123.vercel.app.evil.example")).toBe(false);
    });

    it("never forges https for a host it merely echoes back", () => {
      previewEnv();
      // Even asked over http, the answer is one of the two platform origins.
      const req = fakeRequest({ host: "attacker.example.com" }, "http:");
      expect(getBaseUrl(req)).toBe(`https://${DEPLOY_HOST}`);
    });
  });

  describe("fail-closed", () => {
    it("falls back to the env chain when the platform supplied no host", () => {
      setEnv({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: PROD_HOST,
        NODE_ENV: "production",
      });
      expect(getBaseUrl(fakeRequest({ host: DEPLOY_HOST }))).toBe(`https://${PROD_HOST}`);
    });

    it("is inert when VERCEL_ENV is not 'preview', even with the hosts present", () => {
      setEnv({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: PROD_HOST,
        VERCEL_URL: DEPLOY_HOST,
        VERCEL_BRANCH_URL: BRANCH_HOST,
        NODE_ENV: "production",
      });
      expect(getBaseUrl(fakeRequest({ host: DEPLOY_HOST }))).toBe(`https://${PROD_HOST}`);
      expect(isTrustedAuthHost(DEPLOY_HOST)).toBe(false);
    });

    it("is inert in local development", () => {
      setEnv({ NODE_ENV: "development" });
      expect(getBaseUrl(fakeRequest({ host: "www.elxea.test:3310" }))).toBe(
        "http://localhost:3000",
      );
    });
  });

  it("leaves apex and www resolution untouched on a preview build", () => {
    previewEnv();
    // A production host arriving at a preview deployment is still ours, and is
    // still not allowed to steer the redirect_uri away from this deployment.
    expect(isTrustedAuthHost("www.elxea.com")).toBe(true);
    expect(getBaseUrl(fakeRequest({ host: "www.elxea.com" }))).toBe(`https://${DEPLOY_HOST}`);
  });
});
