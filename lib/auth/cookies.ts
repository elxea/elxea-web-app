import type { NextRequest, NextResponse } from "next/server";

import { env, isProduction } from "@/lib/config";

import type { CookieSpec } from "./cookie-names";
import {
  COOKIE_NAME,
  LINE_SESSION_COOKIES,
  SHOPIFY_SESSION_COOKIES,
} from "./cookie-names";
import { normalizeHost } from "./normalize-host";

/**
 * Single source of truth for auth cookies: their names, their issuing scope,
 * their `secure` rule, and the one function allowed to decide a cookie Domain.
 *
 * ## Why this file exists
 *
 * The names and scopes used to be spelled out at each of six call sites, and the
 * apex test `hostname === "elxea.com" || hostname.endsWith(".elxea.com")` was
 * duplicated verbatim in three of them — fed by two *different* hostname
 * sources (one env-derived, one request-derived). Logout deleted every cookie
 * host-only, but `line-callback` issued the LINE cookies with
 * `domain=.elxea.com`. A host-only delete does not domain-match a Domain-scoped
 * cookie, so those deletes were silent no-ops and `middleware.ts` kept
 * authorising `/account` on the surviving `line_session`. Measured
 * 2026-08-18; see docs/release-gates/gate0-e7121ae.md.
 *
 * ## The two rules this file keeps apart from each other
 *
 * - **Cookie Domain** (here): answers "which hosts share this jar". Output is
 *   `undefined` or the constant `.${AUTH_COOKIE_APEX}` — never a request-derived
 *   string.
 * - **Origin** (`lib/base-url.ts`): answers "which URL did the user arrive on",
 *   and is compared by an IdP against a registered list by exact match.
 *
 * Mixing them broke production once. Nothing here reads or returns an origin,
 * and no function exported from here returns a raw hostname, so a caller cannot
 * accidentally put one in a `Domain` attribute.
 */

/**
 * Validate and canonicalise the apex at module load, so a malformed value fails
 * the process immediately rather than silently producing a cookie Domain that
 * matches nothing.
 *
 * A leading dot is rejected rather than tolerated: this module builds the
 * `Domain` attribute as `.${AUTH_COOKIE_APEX}`, so a value of `".elxea.com"`
 * would yield `..elxea.com` — a Domain that domain-matches no host at all, which
 * is exactly the silent-no-op failure mode this work exists to remove.
 *
 * Note on what is deliberately NOT claimed: there is no assumption that the
 * platform rejects requests for hosts it has not been configured with. No public
 * documentation states that, so the safety of the shared-domain delete rests
 * only on RFC 6265 (a Domain that does not domain-match the request host is
 * ignored by the user agent), not on host filtering upstream.
 */
export function validateApex(raw: string): string {
  /* Canonicalisation is limited to whitespace and case — the two differences
   * that are never a configuration mistake. Everything else is REJECTED rather
   * than silently repaired.
   *
   * That distinction is deliberate. `normalizeHost` exists to tolerate whatever a
   * client puts in a Host header, because we do not control that input. This
   * value is our own configuration, and a trailing dot or an embedded port in it
   * means somebody pasted an origin or an absolute FQDN where a bare apex
   * belongs. Quietly accepting `elxea.com:443` would produce `Domain=.elxea.com`
   * and appear to work, leaving the misconfiguration in place to surface later
   * somewhere less obvious. Failing at module load turns a silent, deferred
   * cookie-scope bug into an immediate, unmissable boot error. */
  const value = raw.trim().toLowerCase();

  if (!value) {
    throw new Error(
      `AUTH_COOKIE_APEX must not be empty (received ${JSON.stringify(raw)}). ` +
        'It must be a bare apex domain such as "elxea.com".',
    );
  }
  if (value.startsWith(".")) {
    throw new Error(
      `AUTH_COOKIE_APEX must not start with a dot (received ${JSON.stringify(raw)}). ` +
        "The leading dot is added when the Domain attribute is built, so a leading " +
        'dot here would produce "..elxea.com", which domain-matches no host at all.',
    );
  }
  if (value.endsWith(".")) {
    throw new Error(
      `AUTH_COOKIE_APEX must not end with a dot (received ${JSON.stringify(raw)}). ` +
        "A trailing dot means an absolute FQDN was pasted where a bare apex belongs.",
    );
  }
  if (value.includes(":") || value.includes("/")) {
    throw new Error(
      "AUTH_COOKIE_APEX must be a bare host, with no port, scheme or path " +
        `(received ${JSON.stringify(raw)}).`,
    );
  }

  /* Run it through the header normaliser too, so the constant used for
   * comparison is produced by the same function that normalises incoming hosts.
   * At this point it is a no-op; running it anyway means the two cannot drift. */
  return normalizeHost(value);
}

/** Canonical apex. Default matches the pre-existing hard-coded production value. */
export const AUTH_COOKIE_APEX = validateApex(env("AUTH_COOKIE_APEX"));

/** The one Domain value this application is ever allowed to emit. */
const SHARED_COOKIE_DOMAIN = `.${AUTH_COOKIE_APEX}`;

// --- registry (moved) --------------------------------------------------------

/**
 * 名前・グループ・scope・secure 規則の正本は `@sot cookie-name-registry`
 * (`lib/auth/cookie-names.ts`)。ここは**その表を使って Domain を決め、発行し、
 * 消す**側で、表そのものは持たない。
 *
 * 切り出した理由はあちらの冒頭に書いてある — 要点は、このファイルは module load 時に
 * `env("AUTH_COOKIE_APEX")` を読むのでクライアント束から import できず、
 * 一方で cookie 名はクライアントの画面からも要るため。
 *
 * 従来 `@/lib/auth/cookies` から名前を import していた呼び出し側を壊さないよう、
 * ここで素通しの re-export を置いてある (2 つ目の定義ではない — 実体は 1 つ)。
 */
export type {
  CookieScope,
  CookieSecureRule,
  CookieGroup,
  CookieSpec,
} from "./cookie-names";
export {
  COOKIE_REGISTRY,
  EXTERNAL_LIBRARY_COOKIES,
  COOKIE_NAME,
  getCookieSpec,
  cookieNamesInGroup,
  AUTH_COOKIE_GROUPS,
  SHOPIFY_SESSION_COOKIES,
  LINE_SESSION_COOKIES,
} from "./cookie-names";


/** `secure` for a given cookie, per its registry rule. */
export function isSecure(spec: CookieSpec): boolean {
  return spec.secure === "always" || isProduction();
}

/**
 * Shopify のセッションが「まだ生きているとみなせるか」を、復号せずに見る。
 *
 * ## 判定は `shop_rt` ただ 1 つ (as-is D-1)
 *
 * 以前ここは 2 か所に分かれていて、どちらも `shop_at`（アクセストークン）を
 * 要求していた。`shop_at` はアクセストークンの寿命を maxAge に持っていたので
 * 数時間でブラウザから消える。その瞬間に `/account` の門
 * (`middleware.ts`) が閉まり、30 日の `shop_rt` を持っている人まで
 * ログイン画面へ弾かれていた。
 *
 * どれだけログインが続くかを決めるのは **リフレッシュトークン**である。
 * アクセストークンが切れているかどうかは別の話で、それは
 * `lib/shopify/auth.ts` の `getSession()` が `shop_exp` の中身を見て判断し、
 * 必要ならリフレッシュする。ここでその 2 つを混ぜない。
 *
 * この module は node crypto を読まないので Edge (middleware) から使える。
 * 判定を持てる唯一の場所なのでここに置く。
 *
 * @param has cookie の有無を返す関数（`(name) => request.cookies.has(name)` 等）。
 *   値を返す関数（`get(name)?.value`）でも動くよう truthy 判定にしてある。
 */
export function hasShopifySessionCookies(
  has: (name: string) => boolean | string | undefined,
): boolean {
  return Boolean(has(COOKIE_NAME.shopRefreshToken));
}

/**
 * LINE だけでログインしている状態か。`hasShopifySessionCookies` の対。
 *
 * ## なぜ 1 行の判定を関数にするのか
 *
 * 同じ `line_session` の有無判定が **5 か所**に別々に書かれていたため
 * (`middleware.ts` / マイページ 2 か所 / 定期便 / ログイン画面)。1 行だから
 * 揃っているだろう、が成り立たないことは同じファイルの
 * `hasShopifySessionCookies` が実証している — あれも「1 行だから」2 か所に
 * 書かれ、片方だけ `shop_at` を要求して門とページの判定が割れた (as-is D-1)。
 *
 * 実際 Wave 4 の棚卸しで同じ割れ方がもう 1 件見つかっている:
 * `app/[locale]/account/page.tsx` は「middleware と同じ条件」と註釈しながら
 * `shop_at && shop_rt` を要求していて、`shop_at` が寿命で消えた人は
 * **middleware は通すのにマイページだけログイン画面に落ちていた**。
 * 註釈は揃っていると言い、コードは揃っていなかった。
 *
 * `httpOnly` の `line_session` **だけ**を見る。`line_user` (表示名の入った
 * 非 httpOnly cookie) を AND 条件に混ぜてはいけない — 表示名が取れたかどうかは
 * 認証の強さと無関係で、混ぜると cookie 掃除で表示名だけ消えた人が
 * 「ログインが必要です」に落ちる。
 *
 * この module は node crypto を読まないので Edge (middleware) から使える。
 *
 * @param has `hasShopifySessionCookies` と同じ。有無でも値でも渡せる。
 */
export function hasLineSessionCookies(
  has: (name: string) => boolean | string | undefined,
): boolean {
  return Boolean(has(COOKIE_NAME.lineSession));
}

/**
 * 「どの経路で入っているか」の鏡。門 (`middleware.ts`) と画面が同じ 1 回の
 * 呼び出しで同じ答えを得るための入り口。
 *
 * 認証を確定させるものではない (それは実データを得たあとの `AccountAuth`)。
 * ここが答えるのは **cookie から見て、その画面を描き始めてよいか** だけ。
 */
export function readSessionMirror(
  has: (name: string) => boolean | string | undefined,
): { shopify: boolean; line: boolean } {
  return {
    shopify: hasShopifySessionCookies(has),
    line: hasLineSessionCookies(has),
  };
}

// --- Domain decision --------------------------------------------------------

/**
 * Read the request's target host, normalised.
 *
 * `Host` is read before `X-Forwarded-Host`: the latter is attacker-controlled
 * (measured — a spoofed value became the resolved hostname verbatim), and Next
 * sets it itself even with no proxy in front, so branching on "is there a proxy"
 * is meaningless. Not exported: a raw hostname must never reach a `Domain`
 * attribute.
 */
function readHostHeader(request: NextRequest): string {
  return normalizeHost(
    request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? "",
  );
}

function isApexMember(host: string): boolean {
  return host === AUTH_COOKIE_APEX || host.endsWith(`.${AUTH_COOKIE_APEX}`);
}

/**
 * The Domain to ISSUE a shared-domain cookie with, for this request.
 *
 * Returns `undefined` (host-only) or the constant `.${AUTH_COOKIE_APEX}` —
 * nothing else, ever. This is used at issue time only. Deletion does NOT consult
 * it; see `clearAuthCookies`.
 */
export function resolveCookieDomain(request: NextRequest): string | undefined {
  return isApexMember(readHostHeader(request)) ? SHARED_COOKIE_DOMAIN : undefined;
}

/** Options for issuing a cookie according to its registry entry. */
export function cookieOptionsFor(
  spec: CookieSpec,
  request: NextRequest,
  extra: { maxAge?: number; httpOnly?: boolean } = {},
): {
  path: string;
  sameSite: "lax";
  secure: boolean;
  httpOnly: boolean;
  domain?: string;
  maxAge?: number;
} {
  const domain =
    spec.scope === "shared-domain" ? resolveCookieDomain(request) : undefined;

  return {
    path: "/",
    sameSite: "lax",
    secure: isSecure(spec),
    httpOnly: extra.httpOnly ?? true,
    ...(domain ? { domain } : {}),
    ...(extra.maxAge === undefined ? {} : { maxAge: extra.maxAge }),
  };
}

// --- deletion ---------------------------------------------------------------

export type ClearScope = "all" | "line" | "shopify";

function namesToClear(scope: ClearScope): readonly string[] {
  switch (scope) {
    case "line":
      return LINE_SESSION_COOKIES;
    case "shopify":
      return SHOPIFY_SESSION_COOKIES;
    case "all":
      return [...SHOPIFY_SESSION_COOKIES, ...LINE_SESSION_COOKIES];
  }
}

/**
 * Clear auth cookies, emitting BOTH a host-only and a shared-domain expiry for
 * every name.
 *
 * ## Why there is no `request` parameter
 *
 * Deliberate, and the most important property in this file. Deletion must not
 * depend on the request: if the shared-domain expiry were only emitted when
 * `resolveCookieDomain(request)` happened to return a Domain, then any request
 * whose Host is unexpected — empty, an unknown host, `localhost`, a
 * platform-internal hop — would silently skip it and leave the session cookies
 * alive. That is precisely the hole being closed, re-introduced as a
 * conditional. Taking no request makes the invariant structural rather than a
 * rule someone has to remember.
 *
 * Emitting a Domain-scoped expiry that does not match the current host is
 * harmless: per RFC 6265 §5.3 step 6 a user agent ignores a Set-Cookie whose
 * Domain does not domain-match the request host. The cost of the extra header is
 * a few bytes; the cost of getting it wrong is a session that never ends.
 *
 * ## Why two passes, and why the second uses a raw header
 *
 * Both measured on the shipped runtime, 2026-08-18:
 *
 *  - `next/dist/compiled/@edge-runtime/cookies/index.js:295` — `set()` stores
 *    into a Map keyed by cookie NAME ONLY. Calling `set()` twice for one name
 *    REPLACES rather than adds, so the naive "set host-only, then set
 *    Domain-scoped" produced 10 Set-Cookie lines, all Domain-scoped: the
 *    host-only expiry vanished and the Shopify session was never cleared.
 *  - same file `:313-319` — `set()` then calls `replace(map, headers)`, which
 *    does `headers.delete("set-cookie")` before re-appending the map. Any raw
 *    append is therefore destroyed by a LATER `set()`. Interleaving the two per
 *    cookie left only the final append alive (11 lines instead of 20).
 *
 * Hence: every `cookies.set()` first, then every `headers.append()`. The result
 * is 2 directives per name, which `__tests__/auth-cookie-clear-parity.test.ts`
 * counts explicitly — checking merely that "a Domain-scoped line exists" cannot
 * tell these three implementations apart.
 */
/**
 * Names awaiting a shared-domain expiry, per response.
 *
 * Needed because the ordering constraint is not just "appends last" — it is
 * "appends after the LAST `set()` anywhere on this response". Two clearing calls
 * on one response would otherwise silently truncate each other: measured
 * 2026-08-18, `clearAuthCookies` followed by `clearFlowCookie` produced 12
 * directives instead of 22, because the second call's `set()` wiped the first
 * call's ten appends.
 *
 * Rather than leave that as a rule to remember, every clearing call re-flushes
 * the full accumulated set. The result is order-independent and composable.
 */
const pendingSharedDomainExpiry = new WeakMap<NextResponse, Set<string>>();

/** Responses whose jar has already been wrapped, so the guard installs once. */
const guardedResponses = new WeakSet<NextResponse>();

/* Derived from `NextResponse` rather than imported from
 * `next/dist/compiled/@edge-runtime/cookies`, so this does not depend on an
 * internal module path that Next is free to move between releases. */
type ResponseCookies = NextResponse["cookies"];

/**
 * PASS 2 — re-emit every pending shared-domain expiry as raw `Set-Cookie` lines.
 *
 * No existing header is inspected, filtered or deleted here. An earlier version
 * dropped every line containing `Domain=.elxea.com` before re-appending, on the
 * theory that it was removing its own stale directives. It was also matching
 * cookies the caller had just ISSUED at that Domain, and deleting them:
 * `/api/line-callback` sets the four LINE session cookies with `domain=.elxea.com`
 * and then clears the state cookie, so all four were destroyed on the way out and
 * the user was never actually logged in. That turned a logout fix into a login
 * outage.
 *
 * Appending the full accumulated set is exact rather than additive, because this
 * only ever runs immediately after a `cookies.set()`, and `set()` goes through
 * `replace()`, which begins with `headers.delete("set-cookie")`. No raw append
 * from an earlier call can still be present.
 */
function flushSharedDomainExpiry(response: NextResponse): void {
  const pending = pendingSharedDomainExpiry.get(response);
  if (!pending) return;
  for (const name of pending) {
    response.headers.append(
      "set-cookie",
      `${name}=; Path=/; Max-Age=0; Domain=${SHARED_COOKIE_DOMAIN}`,
    );
  }
}

/** Duck-type the jar, so a chained `set()` keeps returning the guarded view. */
function isCookieJar(value: unknown): value is ResponseCookies {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { set?: unknown; getAll?: unknown };
  return typeof candidate.set === "function" && typeof candidate.getAll === "function";
}

/**
 * Make the shared-domain expiries survive ANY later cookie operation.
 *
 * The expiries have to be raw `Set-Cookie` headers, because the jar is a Map
 * keyed by cookie name (`@edge-runtime/cookies:295`) and cannot hold two
 * directives — host-only and Domain-scoped — for one name. But every
 * `cookies.set()` runs `replace()` (`:313-319`), which does
 * `headers.delete("set-cookie")` and rebuilds the header list from the jar alone.
 * A single later `set()` anywhere on the response therefore erased all of them:
 * measured, one unrelated `set()` after a clear left 0 of 10 expiries.
 *
 * Rather than leave "clear last" as a rule for every future route author to
 * remember, the jar is wrapped so that each `set()`/`delete()` re-flushes PASS 2
 * straight after `replace()` has run. Ordering stops being a correctness concern.
 *
 * ## Why the wrapper goes on the response, not on the jar
 *
 * An earlier attempt assigned `response.cookies.set = wrapper` and hit a
 * RangeError (maximum call stack exceeded), which was read as proof that the
 * platform makes this undefendable. The real cause is narrower: `NextResponse`
 * exposes the jar through a Proxy whose `get` trap answers `set`/`delete` with
 * `Reflect.apply(target[prop], target, args)` (`next/dist/server/web/spec-extension/response.js:47-66`).
 * Assigning through that Proxy installs the wrapper as an own property ON THE
 * TARGET, so the trap then invokes the wrapper again — it re-enters itself.
 *
 * So the inner Proxy is left untouched. Instead an own `cookies` data property is
 * defined on the response, shadowing the `get cookies()` accessor inherited from
 * `NextResponse.prototype`, and it returns an outer Proxy that delegates to the
 * inner one. Nothing is ever written back through the inner Proxy, so there is no
 * recursion.
 */
function installSharedDomainExpiryGuard(response: NextResponse): void {
  if (guardedResponses.has(response)) return;
  guardedResponses.add(response);

  const jar = response.cookies;

  const guarded: ResponseCookies = new Proxy(jar, {
    get(target, prop, receiver) {
      if (prop !== "set" && prop !== "delete") {
        return Reflect.get(target, prop, receiver);
      }
      /* Read through the inner Proxy's trap, which hands back a fresh closure
       * already bound to the real jar. It is never written back. */
      const original = Reflect.get(target, prop) as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        const result = original(...args);
        flushSharedDomainExpiry(response);
        /* `set()` returns the jar for chaining; hand back the guarded view so a
         * chained call cannot slip past this wrapper. */
        return isCookieJar(result) ? guarded : result;
      };
    },
  }) as ResponseCookies;

  Object.defineProperty(response, "cookies", {
    value: guarded,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

function expireAtBothScopes(response: NextResponse, names: readonly string[]): void {
  /* PASS 2's exactness depends on PASS 1 having re-serialised the jar at least
   * once, which only happens when there is something to set. */
  if (names.length === 0) return;

  const pending = pendingSharedDomainExpiry.get(response) ?? new Set<string>();
  for (const name of names) pending.add(name);
  pendingSharedDomainExpiry.set(response, pending);

  /* Installed BEFORE pass 1 so that pass 1's own `set()` calls flush through it.
   * That is also why there is no explicit PASS 2 call at the end of this
   * function: the guard has already run after the last `set()` below, and adding
   * a trailing flush here would append the whole set a second time. */
  installSharedDomainExpiryGuard(response);

  // PASS 1 — host-only expiry, through the cookie jar.
  for (const name of names) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}

export function clearAuthCookies(response: NextResponse, scope: ClearScope): void {
  expireAtBothScopes(response, namesToClear(scope));
}

/**
 * Expire a single cookie at BOTH scopes, on a response.
 *
 * For one-shot flow cookies (`line_oauth_state`) rather than session cookies, so
 * it takes a name instead of a group — but the two-scope rule is the same, and
 * for the same reason: this codebase has issued `line_oauth_state` at BOTH
 * scopes. `/api/line-login/init` scoped it to the apex while the legacy
 * `/api/line-login` set it host-only. Issuance is unified now, but a cookie set
 * by the old code is still in browsers after this deploys, and that is exactly
 * the mixed case a single-scope delete cannot cover.
 *
 * ## Why this must be on a response, not the `next/headers` store
 *
 * The store is a Map keyed by cookie NAME, like the response jar, so it holds one
 * directive per name and CANNOT emit two scopes. A dual-scope delete is therefore
 * impossible through `cookies().delete()` — it has to go out as raw headers on a
 * response. Same two-pass ordering as `clearAuthCookies`: the `set()` first, then
 * the `append()`, because `set()` re-serialises the jar and wipes any raw header
 * appended before it.
 */
export function clearFlowCookie(response: NextResponse, name: string): void {
  expireAtBothScopes(response, [name]);
}


/**
 * The `(name, domain)` pairs `clearAuthCookies` is expected to expire for a
 * scope. Test fixtures build their expectations from this rather than hard-coding
 * a list, so adding a cookie to the registry cannot leave the parity test
 * asserting against a stale set.
 */
export function expectedClearedPairs(
  scope: ClearScope,
): ReadonlyArray<{ name: string; domain: string | undefined }> {
  return namesToClear(scope).flatMap((name) => [
    { name, domain: undefined },
    { name, domain: SHARED_COOKIE_DOMAIN },
  ]);
}
