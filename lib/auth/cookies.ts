import type { NextRequest, NextResponse } from "next/server";

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
export const AUTH_COOKIE_APEX = validateApex(process.env.AUTH_COOKIE_APEX ?? "elxea.com");

/** The one Domain value this application is ever allowed to emit. */
const SHARED_COOKIE_DOMAIN = `.${AUTH_COOKIE_APEX}`;

// --- registry ---------------------------------------------------------------

/**
 * `host-only` — no Domain attribute; readable only on the exact issuing host.
 * `shared-domain` — Domain-scoped to the apex so `elxea.com` and `www.elxea.com`
 * share one jar. The LINE flow needs this because the init POST can land on
 * either host while the callback always returns to one.
 */
export type CookieScope = "host-only" | "shared-domain";

/**
 * `prod-only` — `secure` mirrors `NODE_ENV === "production"`. This is what lets
 * the flow be exercised over plain http locally and in Ring 2.
 * `always` — `secure` is unconditionally true.
 */
export type CookieSecureRule = "prod-only" | "always";

export type CookieGroup =
  | "shopify-session"
  | "line-session"
  | "transient"
  | "not-auth";

export type CookieSpec = {
  readonly name: string;
  readonly group: CookieGroup;
  readonly scope: CookieScope;
  readonly secure: CookieSecureRule;
};

/**
 * Every cookie this application sets, with the scope it is actually issued at.
 *
 * The scopes are NOT uniform, and that is the crux of the bug this registry
 * closes: a single Domain rule cannot be applied to all of them. Emitting
 * `Domain=.elxea.com` for the Shopify session cookies would fail to clear the
 * host-only ones they are actually issued at, which is a *new* defect — logout
 * that leaves the Shopify session intact.
 */
export const COOKIE_REGISTRY: readonly CookieSpec[] = [
  // Shopify session — issued host-only by auth/callback and lib/shopify/auth.
  { name: "shop_at", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_rt", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_exp", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_it", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_cid", group: "shopify-session", scope: "host-only", secure: "prod-only" },
  { name: "shop_auth", group: "shopify-session", scope: "host-only", secure: "prod-only" },

  // LINE session — issued Domain-scoped by line-callback.
  { name: "line_user", group: "line-session", scope: "shared-domain", secure: "prod-only" },
  { name: "line_auth", group: "line-session", scope: "shared-domain", secure: "prod-only" },
  { name: "line_uid", group: "line-session", scope: "shared-domain", secure: "prod-only" },
  { name: "line_session", group: "line-session", scope: "shared-domain", secure: "prod-only" },

  // Short-lived flow state.
  { name: "shop_cv", group: "transient", scope: "host-only", secure: "prod-only" },
  { name: "shop_state", group: "transient", scope: "host-only", secure: "prod-only" },
  { name: "shop_nonce", group: "transient", scope: "host-only", secure: "prod-only" },
  { name: "shop_locale", group: "transient", scope: "host-only", secure: "prod-only" },
  { name: "shop_return_to", group: "transient", scope: "host-only", secure: "prod-only" },
  /* Shared-domain for the same reason as the LINE session: the init POST may
   * land on apex or www, and the callback returns to whichever host is pinned. A
   * host-only state cookie misses the opposite host and the CSRF check fails —
   * this was seen in production as "session expired" on login. */
  { name: "line_oauth_state", group: "transient", scope: "shared-domain", secure: "always" },
  /* Name verified against lib/line/account-link.ts:22 — it is `acct_link_tk`,
   * not the longer form the design assumed. */
  { name: "acct_link_tk", group: "transient", scope: "host-only", secure: "prod-only" },
  { name: "chat_session_id", group: "transient", scope: "host-only", secure: "always" },

  // Not auth state; listed so the registry is a complete map of what we set.
  { name: "site_auth", group: "not-auth", scope: "host-only", secure: "prod-only" },
  { name: "shopify_cart_id", group: "not-auth", scope: "host-only", secure: "prod-only" },
  { name: "sidebar_state", group: "not-auth", scope: "host-only", secure: "prod-only" },
] as const;

/**
 * Cookies set by third-party libraries, where no `set` call exists in our source
 * for a scanner to find.
 *
 * This list exists so that "unknown cookie name" can be a hard failure. Without
 * it the registry check would have to tolerate anything it did not recognise,
 * which is the same as not checking.
 */
export const EXTERNAL_LIBRARY_COOKIES: readonly string[] = [
  "NEXT_LOCALE", // next-intl
] as const;

/**
 * Named handles for the cookies referenced from code, so call sites read as
 * `COOKIE_NAME.shopAccessToken` rather than repeating a bare string literal.
 *
 * These are `as const` string literals, not computed lookups, so the registry
 * scanner in `__tests__/auth-cookie-registry.test.ts` can still resolve every
 * `cookies.set(...)` argument statically. A scanner that cannot resolve a name
 * has to either guess or ignore, and both defeat the point of the check.
 */
export const COOKIE_NAME = {
  shopAccessToken: "shop_at",
  shopRefreshToken: "shop_rt",
  shopExpiresAt: "shop_exp",
  shopIdToken: "shop_it",
  shopCustomerId: "shop_cid",
  shopAuthFlag: "shop_auth",
  lineUser: "line_user",
  lineAuth: "line_auth",
  lineUid: "line_uid",
  lineSession: "line_session",
  lineOauthState: "line_oauth_state",
  accountLinkToken: "acct_link_tk",
} as const;

const BY_NAME = new Map(COOKIE_REGISTRY.map((s) => [s.name, s]));

export function getCookieSpec(name: string): CookieSpec | undefined {
  return BY_NAME.get(name);
}

export function cookieNamesInGroup(group: CookieGroup): readonly string[] {
  return COOKIE_REGISTRY.filter((s) => s.group === group).map((s) => s.name);
}

/** Names of every cookie that carries authentication state. */
export const AUTH_COOKIE_GROUPS: readonly CookieGroup[] = [
  "shopify-session",
  "line-session",
] as const;

export const SHOPIFY_SESSION_COOKIES = cookieNamesInGroup("shopify-session");
export const LINE_SESSION_COOKIES = cookieNamesInGroup("line-session");

/** `secure` for a given cookie, per its registry rule. */
export function isSecure(spec: CookieSpec): boolean {
  return spec.secure === "always" || process.env.NODE_ENV === "production";
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

function expireAtBothScopes(response: NextResponse, names: readonly string[]): void {
  const pending = pendingSharedDomainExpiry.get(response) ?? new Set<string>();
  for (const name of names) pending.add(name);
  pendingSharedDomainExpiry.set(response, pending);

  // PASS 1 — host-only expiry, through the cookie jar.
  for (const name of names) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }

  /* PASS 2 — shared-domain expiry as raw headers, strictly after every `set()`.
   *
   * The whole accumulated set is re-emitted, and any previously appended copies
   * are dropped first, because `set()` above has just re-serialised the jar and
   * discarded them. Without the drop, a second call would duplicate the first
   * call's directives. */
  const kept = response.headers
    .getSetCookie()
    .filter((raw) => !raw.includes(`Domain=${SHARED_COOKIE_DOMAIN}`));
  response.headers.delete("set-cookie");
  for (const raw of kept) response.headers.append("set-cookie", raw);
  for (const name of pending) {
    response.headers.append(
      "set-cookie",
      `${name}=; Path=/; Max-Age=0; Domain=${SHARED_COOKIE_DOMAIN}`,
    );
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
