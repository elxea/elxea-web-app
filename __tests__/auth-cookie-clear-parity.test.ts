/**
 * T1 — every cookie we ISSUE is actually cancelled by what we DELETE.
 *
 * This is the test that had to exist for the original defect to be impossible.
 * The bug was not "a wrong constant"; it was that issuing and deleting used
 * different, independently-maintained notions of scope, and nothing compared
 * them. So this test derives both sides from the running code and reconciles
 * them. There are no hard-coded expected cookie lists: adding a cookie to the
 * registry without wiring its deletion must fail here.
 *
 * ## Two observation systems, because there are two issuing mechanisms
 *
 *  (a) HTTP responses (`app/api/auth/logout`, `app/api/line-callback`) —
 *      observed by parsing real `Set-Cookie` headers off the real Response.
 *  (b) The `next/headers` cookie store (`lib/shopify/auth.ts:setSessionCookies`)
 *      — there is no HTTP response to inspect, so the store is mocked and its
 *      `set()` / `delete()` calls are recorded.
 *
 * ## Why the recorder keys on (name, domain) and not name
 *
 * Next's cookie jar is itself a Map keyed by name only. A recorder that did the
 * same would collapse the host-only and Domain-scoped directives for one cookie
 * into a single entry and could not distinguish "both scopes were emitted" from
 * "only the last one was" — which is exactly the class of bug being tested.
 * `delete(name)` with no options is recorded as a host-only deletion ONLY, so an
 * implementation that clears a Domain-scoped cookie with a bare `delete(name)`
 * fails this test. The `naive` reference implementations at the bottom prove that
 * failure actually happens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_COOKIE_APEX,
  LINE_SESSION_COOKIES,
  SHOPIFY_SESSION_COOKIES,
  clearAuthCookies,
  clearFlowCookie,
  cookieOptionsFor,
  expectedClearedPairs,
  getCookieSpec,
  validateApex,
} from "@/lib/auth/cookies";

// --- observation helpers ----------------------------------------------------

type Pair = { name: string; domain: string | undefined };

/** A Set-Cookie directive, reduced to what scope reconciliation needs. */
type Directive = Pair & { expires: boolean; raw: string };

function parseSetCookie(raw: string): Directive {
  const [nameValue, ...attrs] = raw.split(";").map((s) => s.trim());
  const name = nameValue.split("=")[0];
  let domain: string | undefined;
  let expires = false;
  for (const attr of attrs) {
    const [k, v] = attr.split("=");
    const key = k.toLowerCase();
    if (key === "domain") domain = v?.toLowerCase();
    if (key === "max-age" && Number(v) <= 0) expires = true;
    if (key === "expires" && v && new Date(v).getTime() <= Date.now()) expires = true;
  }
  return { name, domain, expires, raw };
}

function directivesOf(res: Response): Directive[] {
  return res.headers.getSetCookie().map(parseSetCookie);
}

function pairKey(p: Pair): string {
  return `${p.name}@${p.domain ?? "(host-only)"}`;
}

function sortedKeys(pairs: readonly Pair[]): string[] {
  return [...new Set(pairs.map(pairKey))].sort();
}

// --- next/headers store recorder -------------------------------------------

type StoreCall = { op: "set" | "delete"; name: string; domain: string | undefined };

function makeStoreRecorder(seed: Record<string, string> = {}) {
  const calls: StoreCall[] = [];
  const store = {
    get: (name: string) => (name in seed ? { name, value: seed[name] } : undefined),
    has: (name: string) => name in seed,
    set: (...args: unknown[]) => {
      // Both call shapes: set(name, value, options) and set({ name, value, ... }).
      if (typeof args[0] === "string") {
        const opts = (args[2] ?? {}) as { domain?: string };
        calls.push({ op: "set", name: args[0], domain: opts.domain });
      } else {
        const o = args[0] as { name: string; domain?: string };
        calls.push({ op: "set", name: o.name, domain: o.domain });
      }
    },
    delete: (...args: unknown[]) => {
      /* `delete(name)` carries no Domain, so it is recorded as a HOST-ONLY
       * deletion. This is the whole point of recording pairs: a bare delete
       * cannot cancel a Domain-scoped cookie, and the reconciliation below must
       * be able to see that. */
      if (typeof args[0] === "string") {
        calls.push({ op: "delete", name: args[0], domain: undefined });
      } else {
        const o = args[0] as { name: string; domain?: string };
        calls.push({ op: "delete", name: o.name, domain: o.domain });
      }
    },
  };
  return { calls, store };
}

const cookiesMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

// --- fixtures ---------------------------------------------------------------

/**
 * The seven Host patterns the design requires, plus the adversarial ones the
 * deletion path must survive. Deletion must behave identically for ALL of them.
 */
const HOST_PATTERNS = [
  "www.elxea.com",
  "elxea.com",
  "WWW.ELXEA.COM:443",
  "www.elxea.com.",
  "preview-abc.vercel.app",
  "localhost:3000",
  "www.elxea.test",
  "",
  "attacker.example.com",
] as const;

function logoutRequest(host: string) {
  const headers: Record<string, string> = {};
  if (host) headers.host = host;
  return new NextRequest("http://www.elxea.com/api/auth/logout?locale=ja", { headers });
}

const SAVED_ENV = {
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  LINE_ALLOWED_CALLBACK_HOSTS: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://www.elxea.com";
  delete process.env.LINE_ALLOWED_CALLBACK_HOSTS;
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ---------------------------------------------------------------------------

describe("clearAuthCookies emits both scopes for every name", () => {
  it.each(["all", "line", "shopify"] as const)(
    "scope=%s produces exactly one host-only and one shared-domain expiry per cookie",
    (scope) => {
      const res = NextResponse.redirect("https://www.elxea.com/ja");
      clearAuthCookies(res, scope);

      const directives = directivesOf(res);
      expect(directives.every((d) => d.expires), "every directive must expire").toBe(true);

      /* Count, not "contains". The three broken implementations measured on
       * 2026-08-18 differed only in COUNT: 10 (Domain-only, host-only lost),
       * 11 (interleaved append, all but one lost), 20 (correct). A "a
       * Domain-scoped line exists" assertion passes for the first of those. */
      expect(sortedKeys(directives)).toEqual(sortedKeys(expectedClearedPairs(scope)));
      expect(directives).toHaveLength(expectedClearedPairs(scope).length);
    },
  );

  it("clears 20 directives for scope=all (10 host-only + 10 shared-domain)", () => {
    const res = NextResponse.redirect("https://www.elxea.com/ja");
    clearAuthCookies(res, "all");

    const directives = directivesOf(res);
    expect(directives).toHaveLength(20);
    expect(directives.filter((d) => d.domain === undefined)).toHaveLength(10);
    expect(directives.filter((d) => d.domain === ".elxea.com")).toHaveLength(10);
  });
});

describe("deletion is request-independent (design gate 1)", () => {
  it.each(HOST_PATTERNS)("logout emits the shared-domain expiry for Host=%s", async (host) => {
    const { GET } = await import("@/app/api/auth/logout/route");
    const res = await GET(logoutRequest(host));
    const directives = directivesOf(res);

    const shared = directives.filter((d) => d.domain === ".elxea.com" && d.expires);
    const hostOnly = directives.filter((d) => d.domain === undefined && d.expires);

    /* An unknown / empty / localhost Host must not change the outcome. If any of
     * these emitted fewer directives, the hole would be back for that host. */
    expect(sortedKeys(shared)).toEqual(
      sortedKeys(
        expectedClearedPairs("all").filter((p) => p.domain !== undefined),
      ),
    );
    expect(sortedKeys(hostOnly)).toEqual(
      sortedKeys(expectedClearedPairs("all").filter((p) => p.domain === undefined)),
    );
  });

  it("produces byte-identical Set-Cookie sets across every Host pattern", async () => {
    const { GET } = await import("@/app/api/auth/logout/route");
    const sets = await Promise.all(
      HOST_PATTERNS.map(async (host) => {
        const res = await GET(logoutRequest(host));
        return directivesOf(res)
          .map((d) => d.raw)
          .sort()
          .join("\n");
      }),
    );
    // One distinct value => no request-derived branching in the delete path.
    expect(new Set(sets).size).toBe(1);
  });
});

describe("issued cookies are reconciled against deleted cookies", () => {
  it("every Shopify session cookie issued through the store is cancelled", async () => {
    const { calls, store } = makeStoreRecorder();
    cookiesMock.mockResolvedValue(store);

    const { setSessionCookies } = await import("@/lib/shopify/auth");
    await setSessionCookies("access-token", "refresh-token", 3600);

    const issued = calls.filter((c) => c.op === "set").map(({ name, domain }) => ({ name, domain }));
    expect(issued.length, "the store path must have issued something").toBeGreaterThan(0);

    const cleared = new Set(expectedClearedPairs("all").map(pairKey));
    for (const pair of issued) {
      expect(cleared.has(pairKey(pair)), `${pairKey(pair)} is issued but never cleared`).toBe(true);
    }

    /* And they are host-only, which is why a Domain-only delete would strand
     * them — the R2 design the document rejects. */
    expect(issued.every((p) => p.domain === undefined)).toBe(true);
    expect(issued.map((p) => p.name).sort()).toEqual(
      SHOPIFY_SESSION_COOKIES.filter((n) => n !== "shop_it" && n !== "shop_cid").sort(),
    );
  });

  it("every LINE session cookie issued at the apex is cancelled at that Domain", () => {
    const request = new NextRequest("http://www.elxea.com/api/line-callback", {
      headers: { host: "www.elxea.com" },
    });

    /* Built through the same function the route uses, so this reflects the real
     * issuing rule rather than a transcription of it. */
    const issued = LINE_SESSION_COOKIES.map((name) => {
      const opts = cookieOptionsFor(getCookieSpec(name)!, request);
      return { name, domain: opts.domain };
    });

    expect(issued.every((p) => p.domain === ".elxea.com")).toBe(true);

    const cleared = new Set(expectedClearedPairs("all").map(pairKey));
    for (const pair of issued) {
      expect(cleared.has(pairKey(pair)), `${pairKey(pair)} is issued but never cleared`).toBe(true);
    }
  });

  it("LINE cookies issued host-only (non-apex host) are also cancelled", () => {
    const request = new NextRequest("http://localhost:3000/api/line-callback", {
      headers: { host: "localhost:3000" },
    });

    const issued = LINE_SESSION_COOKIES.map((name) => ({
      name,
      domain: cookieOptionsFor(getCookieSpec(name)!, request).domain,
    }));

    expect(issued.every((p) => p.domain === undefined)).toBe(true);

    const cleared = new Set(expectedClearedPairs("all").map(pairKey));
    for (const pair of issued) {
      expect(cleared.has(pairKey(pair)), `${pairKey(pair)} is issued but never cleared`).toBe(true);
    }
  });
});

describe("one-shot flow cookies are also expired at both scopes", () => {
  /* `line_oauth_state` was issued at BOTH scopes historically: /api/line-login/init
   * scoped it to the apex, the legacy /api/line-login set it host-only. Both
   * shapes exist in real browsers when this deploys, so a single-scope delete
   * cannot clear them all — the same trap as the session cookies, on a cookie
   * that gates CSRF. */
  it("clearFlowCookie emits exactly one host-only and one shared-domain expiry", () => {
    const res = NextResponse.redirect("https://www.elxea.com/ja/login");
    clearFlowCookie(res, "line_oauth_state");

    const directives = directivesOf(res);
    expect(directives).toHaveLength(2);
    expect(directives.every((d) => d.expires && d.name === "line_oauth_state")).toBe(true);
    expect(sortedKeys(directives)).toEqual(
      sortedKeys([
        { name: "line_oauth_state", domain: undefined },
        { name: "line_oauth_state", domain: ".elxea.com" },
      ]),
    );
  });

  it("composes with clearAuthCookies in either order", () => {
    /* Ordering trap: `cookies.set()` re-serialises the jar and drops raw appends,
     * so a second clearing call used to truncate the first (measured: 12
     * directives instead of 22). Both orders must now yield the same 22. */
    const a = NextResponse.redirect("https://www.elxea.com/ja");
    clearAuthCookies(a, "all");
    clearFlowCookie(a, "line_oauth_state");

    const b = NextResponse.redirect("https://www.elxea.com/ja");
    clearFlowCookie(b, "line_oauth_state");
    clearAuthCookies(b, "all");

    expect(directivesOf(a)).toHaveLength(22);
    expect(directivesOf(b)).toHaveLength(22);
    expect(sortedKeys(directivesOf(a))).toEqual(sortedKeys(directivesOf(b)));
  });

  it("is idempotent — calling twice does not duplicate directives", () => {
    const res = NextResponse.redirect("https://www.elxea.com/ja");
    clearAuthCookies(res, "all");
    clearAuthCookies(res, "all");
    expect(directivesOf(res)).toHaveLength(20);
  });
});

describe("AUTH_COOKIE_APEX is validated at module load", () => {
  /* The apex is the one input that turns every Domain-scoped directive into a
   * no-op if it is wrong, and a wrong one FAILS SILENTLY: cookies simply never
   * get cleared. So malformed values are rejected loudly at boot rather than
   * repaired. */
  it.each([
    [".elxea.com", "leading dot would build ..elxea.com"],
    ["elxea.com.", "absolute FQDN pasted where a bare apex belongs"],
    ["elxea.com:443", "an origin pasted where a bare apex belongs"],
    ["", "empty"],
    ["   ", "whitespace only"],
    ["https://elxea.com", "a scheme pasted in"],
    ["elxea.com/path", "a path pasted in"],
  ])("rejects %j (%s)", (value) => {
    expect(() => validateApex(value)).toThrow(/AUTH_COOKIE_APEX/);
  });

  it.each([
    ["elxea.com", "elxea.com"],
    ["ELXEA.COM", "elxea.com"],
    ["  elxea.com  ", "elxea.com"],
    ["elxea.test", "elxea.test"],
  ])("accepts and canonicalises %j -> %j", (value, expected) => {
    expect(validateApex(value)).toBe(expected);
  });

  it("the live constant is usable as a Domain suffix", () => {
    expect(AUTH_COOKIE_APEX).toBe("elxea.com");
    expect(`.${AUTH_COOKIE_APEX}`).toBe(".elxea.com");
  });
});

describe("the checker has teeth: known-broken implementations must fail it", () => {
  /** The R2 design the document rejects: one Domain rule for everything. */
  function naiveDomainOnly(res: NextResponse) {
    for (const name of [...SHOPIFY_SESSION_COOKIES, ...LINE_SESSION_COOKIES]) {
      res.cookies.set(name, "", { path: "/", maxAge: 0, domain: ".elxea.com" });
    }
  }

  /** The original bug: host-only deletes only. */
  function naiveHostOnly(res: NextResponse) {
    for (const name of [...SHOPIFY_SESSION_COOKIES, ...LINE_SESSION_COOKIES]) {
      res.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
  }

  /** The measured trap: two `set()` calls, second silently replacing the first. */
  function naiveTwoSetCalls(res: NextResponse) {
    for (const name of [...SHOPIFY_SESSION_COOKIES, ...LINE_SESSION_COOKIES]) {
      res.cookies.set(name, "", { path: "/", maxAge: 0 });
      res.cookies.set(name, "", { path: "/", maxAge: 0, domain: ".elxea.com" });
    }
  }

  /** The measured trap: interleaved raw append, destroyed by the next set(). */
  function naiveInterleavedAppend(res: NextResponse) {
    for (const name of [...SHOPIFY_SESSION_COOKIES, ...LINE_SESSION_COOKIES]) {
      res.cookies.set(name, "", { path: "/", maxAge: 0 });
      res.headers.append("set-cookie", `${name}=; Path=/; Max-Age=0; Domain=.elxea.com`);
    }
  }

  it.each([
    ["Domain-only (the rejected R2 design)", naiveDomainOnly, 10],
    ["host-only (the original bug)", naiveHostOnly, 10],
    ["two set() calls (name-keyed jar swallows one)", naiveTwoSetCalls, 10],
    ["interleaved append (replace() wipes it)", naiveInterleavedAppend, 11],
  ])("%s emits %i directives, not 20, and fails reconciliation", (_label, impl, expectedCount) => {
    const res = NextResponse.redirect("https://www.elxea.com/ja");
    impl(res);

    const directives = directivesOf(res);
    expect(directives).toHaveLength(expectedCount);
    expect(sortedKeys(directives)).not.toEqual(sortedKeys(expectedClearedPairs("all")));
  });

  it("a bare store delete(name) is recorded host-only and cannot cancel an apex cookie", () => {
    const { calls, store } = makeStoreRecorder();
    store.delete("line_session");

    expect(calls).toEqual([{ op: "delete", name: "line_session", domain: undefined }]);

    // The apex-scoped cookie is NOT among what this cancelled.
    const cancelled = new Set(calls.map(({ name, domain }) => pairKey({ name, domain })));
    expect(cancelled.has(pairKey({ name: "line_session", domain: ".elxea.com" }))).toBe(false);
  });
});
