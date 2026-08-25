/**
 * T3 — /account authorisation, driven by the state logout actually leaves behind.
 *
 * The defect was never visible in the middleware: its rule ("a Shopify session OR
 * a LINE session lets you through") was correct all along. What was wrong was the
 * state it was asked to judge — logout left `line_session` alive, so the guard
 * dutifully let a logged-out user into `/account`.
 *
 * So the interesting case here is not hand-written. It is computed from what
 * `clearAuthCookies` actually emits, applied to a cookie jar, and then fed to the
 * guard. If deletion ever regresses to a single scope, this test fails without
 * anyone having to remember to update an expectation.
 */
import { describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { LINE_SESSION_COOKIES, clearAuthCookies } from "@/lib/auth/cookies";

/**
 * Only the i18n layer is stubbed, and only because it cannot load here:
 * `next-intl/middleware` resolves `next/server` in a way that fails under the
 * node test environment ("Cannot find module .../next/server — did you mean
 * next/server.js?").
 *
 * This does not stub out what is under test. In `middleware.ts` the /account
 * authorisation block runs and RETURNS before `intlMiddleware(request)` is ever
 * reached; the intl middleware is only called on the fall-through path, which is
 * precisely the "allowed through" case. So:
 *
 *   - a redirect to /ja/login is produced entirely by the real guard;
 *   - "allowed through" is observed as the ABSENCE of that redirect — the real
 *     guard declining to act — not as something the stub asserts.
 *
 * The stub therefore cannot manufacture a pass. If the guard stopped redirecting
 * when it should, the redirect assertions fail; if it started redirecting when it
 * should not, the pass-through assertions fail. The stub only supplies a
 * terminal value for the path the guard has already decided to allow.
 */
vi.mock("next-intl/middleware", () => ({
  default: () => (_request: NextRequest) => NextResponse.next(),
}));

/* Read at module load in middleware.ts. Unset means the site-password gate is
 * inactive, which is the condition these tests are written against. */
delete process.env.SITE_PASSWORD;

/** Minimal cookie jar: applies Set-Cookie directives the way a browser would. */
class Jar {
  private entries = new Map<string, { name: string; value: string; domain?: string }>();

  set(name: string, value: string, domain?: string) {
    this.entries.set(`${name}@${domain ?? ""}`, { name, value, domain });
  }

  /**
   * Apply one Set-Cookie line for a request to `requestHost`.
   *
   * The domain-match rule is the point of this class: a directive whose Domain
   * does not domain-match the request host is IGNORED (RFC 6265 §5.3 step 6) —
   * that is why an over-broad delete is harmless, and why a host-only delete
   * cannot touch a Domain-scoped cookie.
   */
  applySetCookie(raw: string, requestHost: string) {
    const [nameValue, ...attrs] = raw.split(";").map((s) => s.trim());
    const eq = nameValue.indexOf("=");
    const name = nameValue.slice(0, eq);
    const value = nameValue.slice(eq + 1);

    let domain: string | undefined;
    let expired = false;
    for (const attr of attrs) {
      const [k, v] = attr.split("=");
      if (k.toLowerCase() === "domain") domain = v?.toLowerCase();
      if (k.toLowerCase() === "max-age" && Number(v) <= 0) expired = true;
    }

    if (domain) {
      const bare = domain.replace(/^\./, "");
      const matches = requestHost === bare || requestHost.endsWith(`.${bare}`);
      if (!matches) return; // ignored by the UA
    }

    const key = `${name}@${domain ?? ""}`;
    if (expired) this.entries.delete(key);
    else this.set(name, value, domain);
  }

  /** What the browser would send on the next request. */
  header(): string {
    return [...this.entries.values()].map((c) => `${c.name}=${c.value}`).join("; ");
  }

  names(): string[] {
    return [...new Set([...this.entries.values()].map((c) => c.name))].sort();
  }
}

async function requestAccount(cookieHeader: string) {
  const { default: middleware } = await import("@/middleware");
  const headers: Record<string, string> = { host: "www.elxea.com" };
  if (cookieHeader) headers.cookie = cookieHeader;
  const req = new NextRequest("https://www.elxea.com/ja/account", { headers });
  return (await middleware(req)) as NextResponse;
}

async function requestLogin(cookieHeader: string, search = "") {
  const { default: middleware } = await import("@/middleware");
  const headers: Record<string, string> = { host: "www.elxea.com" };
  if (cookieHeader) headers.cookie = cookieHeader;
  const req = new NextRequest(`https://www.elxea.com/ja/login${search}`, { headers });
  return (await middleware(req)) as NextResponse;
}

function redirectedTo(res: NextResponse): string | null {
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname : null;
}

function redirectedToUrl(res: NextResponse): URL | null {
  const loc = res.headers.get("location");
  return loc ? new URL(loc) : null;
}

describe("/account guard", () => {
  it("redirects to /ja/login with no cookies at all", async () => {
    expect(redirectedTo(await requestAccount(""))).toBe("/ja/login");
  });

  it("lets a LINE-only session through (this is intended behaviour)", async () => {
    expect(redirectedTo(await requestAccount("line_session=1"))).toBeNull();
  });

  it("lets a Shopify session through", async () => {
    expect(redirectedTo(await requestAccount("shop_at=x; shop_rt=y"))).toBeNull();
  });

  it("requires BOTH Shopify tokens, not either", async () => {
    expect(redirectedTo(await requestAccount("shop_at=x"))).toBe("/ja/login");
  });
});

/**
 * /login guard — 二重アカウントの入口を閉じる。ただし連携の入口は閉じない。
 *
 * 監査 2026-08-25 #10: ログイン中でも /ja/login が素通しで、そこで別の方法を押すと
 * もう 1 つアカウントを作れた。門を閉じる条件を「Shopify セッションがあるとき」に
 * 限っているのが要点で、LINE だけの人にとってこの画面の「メールアドレスでログイン」
 * は連携の唯一の入口なので閉じてはいけない。
 */
describe("/login guard", () => {
  it("何のセッションも無ければ素通し (通常のログイン画面)", async () => {
    expect(redirectedTo(await requestLogin(""))).toBeNull();
  });

  it("Shopify セッションがあればマイページへ送り、理由を渡す", async () => {
    const url = redirectedToUrl(await requestLogin("shop_at=x; shop_rt=y"));
    expect(url?.pathname).toBe("/ja/account");
    expect(url?.searchParams.get("notice")).toBe("already-signed-in");
  });

  it("LINE だけの人は飛ばさない (ここが連携の入口)", async () => {
    expect(redirectedTo(await requestLogin("line_session=1"))).toBeNull();
  });

  it("認証フローの戻り (?error= / ?linked=) は素通しする", async () => {
    expect(
      redirectedTo(await requestLogin("shop_at=x; shop_rt=y", "?error=LineAuthFailed")),
    ).toBeNull();
    expect(
      redirectedTo(await requestLogin("shop_at=x; shop_rt=y", "?linked=true")),
    ).toBeNull();
  });

  it("/login 配下 (完了画面など) は対象にしない", async () => {
    const { default: middleware } = await import("@/middleware");
    const req = new NextRequest("https://www.elxea.com/ja/login/complete", {
      headers: { host: "www.elxea.com", cookie: "shop_at=x; shop_rt=y" },
    });
    expect(redirectedTo((await middleware(req)) as NextResponse)).toBeNull();
  });
});

describe("the post-logout state computed from clearAuthCookies is unauthenticated", () => {
  /** Build a jar holding an apex-scoped LINE session, as line-callback issues it. */
  function jarWithApexLineSession(): Jar {
    const jar = new Jar();
    for (const name of LINE_SESSION_COOKIES) jar.set(name, "1", ".elxea.com");
    return jar;
  }

  it("apex-scoped LINE cookies are cleared, and /account then redirects", async () => {
    const jar = jarWithApexLineSession();
    expect(redirectedTo(await requestAccount(jar.header()))).toBeNull(); // logged in

    const res = NextResponse.redirect("https://www.elxea.com/ja");
    clearAuthCookies(res, "all");
    for (const raw of res.headers.getSetCookie()) {
      jar.applySetCookie(raw, "www.elxea.com");
    }

    expect(jar.names(), "no LINE cookie may survive logout").toEqual([]);
    expect(redirectedTo(await requestAccount(jar.header()))).toBe("/ja/login");
  });

  it("host-only LINE cookies are cleared too (dev / preview issuing)", async () => {
    const jar = new Jar();
    for (const name of LINE_SESSION_COOKIES) jar.set(name, "1");

    const res = NextResponse.redirect("https://www.elxea.com/ja");
    clearAuthCookies(res, "all");
    for (const raw of res.headers.getSetCookie()) {
      jar.applySetCookie(raw, "www.elxea.com");
    }

    expect(jar.names()).toEqual([]);
    expect(redirectedTo(await requestAccount(jar.header()))).toBe("/ja/login");
  });

  it("the ORIGINAL host-only-only deletion leaves the hole open", async () => {
    /* The regression this whole change exists to prevent, kept executable: with
     * the old delete, the apex-scoped `line_session` survives and /account still
     * lets the user in. */
    const jar = jarWithApexLineSession();
    for (const name of LINE_SESSION_COOKIES) {
      jar.applySetCookie(`${name}=; Path=/; Max-Age=0`, "www.elxea.com");
    }

    expect(jar.names()).toEqual([...LINE_SESSION_COOKIES].sort());
    expect(redirectedTo(await requestAccount(jar.header()))).toBeNull();
  });
});
