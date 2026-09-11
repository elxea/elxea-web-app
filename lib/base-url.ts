import type { NextRequest } from "next/server";

import { AUTH_COOKIE_APEX } from "@/lib/auth/cookies";
import { normalizeHost } from "@/lib/auth/normalize-host";

/**
 * Origin resolution for anything we hand to an identity provider (OAuth
 * `redirect_uri`, OIDC `post_logout_redirect_uri`) or use for an in-site
 * redirect.
 *
 * This is NOT the same rule as cookie-Domain resolution — see
 * `lib/auth/cookies.ts`. Cookie Domain answers "which hosts share this jar" and
 * may only ever emit a fixed constant. Origin answers "which URL did the user
 * actually arrive on", and an IdP compares it against a registered allow-list by
 * exact string match. Conflating the two broke production once; keep them apart.
 *
 * ## Why the request origin is gated rather than simply preferred
 *
 * The pre-existing behaviour pins every callback to one env-configured host.
 * `app/api/line-login/init/route.ts` documents why: the initial POST can land on
 * either `elxea.com` or `www.elxea.com`, but the callback must return to the one
 * host registered with LINE, because LINE matches callback URLs exactly. Using
 * the request origin unconditionally would send users back to whichever host
 * they happened to open, and any host not in the IdP's list fails the match —
 * i.e. it breaks production login for half the visitors.
 *
 * So the request origin is used only when we have positive evidence that the
 * host is registered: `LINE_ALLOWED_CALLBACK_HOSTS` must be set AND the request
 * host must be in it. With the env unset, behaviour is byte-identical to the
 * previous implementation — that is the property `__tests__/base-url-resolution.test.ts`
 * pins across every env combination, including the production throw.
 */

/**
 * ## Preview deployments (added 2026-08-18)
 *
 * `resolveFromEnv` returns `VERCEL_PROJECT_PRODUCTION_URL` on a preview, because
 * Vercel injects that variable into *every* environment while `NEXTAUTH_URL` is
 * set in none. So a LINE round trip started on a preview was handed a
 * `redirect_uri` pointing at PRODUCTION: the user came back to the production
 * deployment (old build, `line_oauth_state` cookie missing → StateMismatch →
 * bounced to `/password` by the site-password gate). That single mis-resolution
 * is the root cause behind all three reported symptoms.
 *
 * The fix does not go in the environment. A preview's URL changes on every
 * deploy, so pinning one value would freeze every preview onto one deployment —
 * a different breakage. It is resolved from the values the *platform* hands the
 * running deployment instead.
 *
 * Two properties make this safe to put in front of a `redirect_uri`:
 *
 * 1. **Nothing untrusted enters.** The accepted origins are exactly
 *    `VERCEL_URL` and `VERCEL_BRANCH_URL`, both injected by Vercel into the
 *    server process. The request's `Host` is only ever used to *choose between*
 *    those two — it can never introduce a third value. `Host: evil.example`
 *    matches neither and is discarded.
 * 2. **Production cannot be touched.** Every branch here is gated on
 *    `VERCEL_ENV === "preview"`, a value only Vercel sets. In production and in
 *    local dev the whole mechanism is inert and resolution is byte-identical to
 *    before — pinned by the exhaustive parity test in
 *    `__tests__/base-url-resolution.test.ts`.
 *
 * Fail-closed: if `VERCEL_ENV` says preview but the platform supplied no
 * deployment host, this contributes nothing and the env chain runs as before.
 */
function isPreviewDeployment(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

/**
 * Hostnames the platform itself assigned to THIS deployment, in preference
 * order (`VERCEL_URL` is the immutable per-deployment host; `VERCEL_BRANCH_URL`
 * is the stable per-branch alias). Both are set by Vercel, never by a client.
 */
function platformDeploymentHosts(): string[] {
  return [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .map((h) => normalizeHost(h ?? ""))
    .filter(Boolean);
}

/**
 * The origin a preview deployment should hand an IdP, or `null` when this is
 * not a preview / the platform gave us nothing to work with.
 *
 * When a request is available and its host is one the platform assigned, that
 * one wins — a preview is reachable on both the deployment URL and the branch
 * URL, and the user has to come back to the host their cookies were set on.
 * Otherwise the deployment's own URL is used, which involves no request input
 * at all.
 */
function resolvePreviewOrigin(request?: NextRequest): string | null {
  if (!isPreviewDeployment()) return null;

  const hosts = platformDeploymentHosts();
  if (hosts.length === 0) return null;

  if (request) {
    const authority = normalizeHost(readRequestAuthority(request));
    if (authority && hosts.includes(authority)) return `https://${authority}`;
  }

  return `https://${hosts[0]}`;
}

/** Priority is unchanged from the original implementation. */
function resolveFromEnv(): string {
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

/**
 * The raw authority (`host[:port]`) the request was addressed to, lowercased.
 *
 * `Host` is read BEFORE `X-Forwarded-Host`. The latter is attacker-controlled —
 * measured on a probe, `X-Forwarded-Host: attacker.example.com` became the
 * resolved hostname verbatim — and Next adds it itself even with no proxy in
 * front, so branching on "is there a proxy" is meaningless. Preferring `Host`
 * costs nothing: Vercel passes the real request `Host` through.
 *
 * Port is retained here because an origin needs it; `normalizeHost` strips it
 * for allow-list comparison.
 */
function readRequestAuthority(request: NextRequest): string {
  const raw = request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? "";
  return raw.split(",")[0].trim().toLowerCase();
}

/**
 * Is `hostname` a host we know an IdP will accept a redirect back to?
 *
 * `LINE_ALLOWED_CALLBACK_HOSTS` is a comma-separated host list. **Unset means
 * `true`** — deliberately fail-open, because this gate is introduced onto a
 * working production system and a fail-closed default would take login down the
 * moment it shipped without the env var. The value is the switch that turns the
 * gate on.
 */
export function isRegisteredAuthHost(hostname: string): boolean {
  const configured = process.env.LINE_ALLOWED_CALLBACK_HOSTS;
  if (!configured) return true;

  const allowed = configured
    .split(",")
    .map((h) => normalizeHost(h))
    .filter(Boolean);

  // A set-but-empty/whitespace value is treated as "not configured" rather than
  // "deny everything", for the same reason the unset case is fail-open.
  if (allowed.length === 0) return true;

  return allowed.includes(normalizeHost(hostname));
}

/**
 * Is this a host we are willing to build an auth URL or a redirect target from?
 *
 * Unlike `isRegisteredAuthHost`, this is **fail-closed**: an unknown host is
 * never trusted, whether or not `LINE_ALLOWED_CALLBACK_HOSTS` is configured. A
 * host qualifies only by being at or under our own apex, or by being named
 * explicitly in the allow-list.
 *
 * The two functions answer different questions and both are needed.
 * `isRegisteredAuthHost` asks "has an operator declared this host to the IdP?",
 * and has to stay fail-open so that introducing the variable cannot take
 * production down. This one asks "is this host ours?", which we can answer from
 * the apex alone, with no configuration and no trust in the request.
 *
 * The apex suffix test uses a leading dot so that `evil-elxea.com` does not pass
 * as a subdomain of `elxea.com`.
 */
export function isTrustedAuthHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === AUTH_COOKIE_APEX) return true;
  if (hostname.endsWith(`.${AUTH_COOKIE_APEX}`)) return true;
  /* A preview is reached on a `*.vercel.app` host, which is not under our apex.
   * The platform told this process which hosts those are, so they are ours by
   * the same standard the apex test applies — and only on a preview. */
  if (isPreviewDeployment() && platformDeploymentHosts().includes(hostname)) return true;
  return Boolean(process.env.LINE_ALLOWED_CALLBACK_HOSTS) && isRegisteredAuthHost(hostname);
}

/**
 * Resolve the application base URL.
 *
 * With no argument, identical to the original env-only implementation
 * (`NEXTAUTH_URL` > `VERCEL_PROJECT_PRODUCTION_URL` > `VERCEL_URL`, throwing in
 * production when none are set, `http://localhost:3000` otherwise).
 *
 * With a request, the request's own origin is returned instead — but only when
 * `LINE_ALLOWED_CALLBACK_HOSTS` is configured and lists this host. Otherwise it
 * falls through to the env chain, so an unregistered host (a preview
 * deployment, say) can never become a `redirect_uri` we send to an IdP.
 */
export function getBaseUrl(request?: NextRequest): string {
  if (request && process.env.LINE_ALLOWED_CALLBACK_HOSTS) {
    const authority = readRequestAuthority(request);
    if (authority && isRegisteredAuthHost(authority)) {
      /* `request.nextUrl.protocol` reports the server's own scheme, which is
       * http on Vercel's internal hop, so prefer the forwarded scheme when the
       * platform supplies one. */
      const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
      const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "") || "https";
      return `${protocol}://${authority}`;
    }
  }

  /* Preview only, and only from platform-supplied hosts. Inert in production
   * and in local dev — see `resolvePreviewOrigin`. */
  const previewOrigin = resolvePreviewOrigin(request);
  if (previewOrigin) return previewOrigin;

  return resolveFromEnv();
}

/**
 * The normalised hostname a request was addressed to. Exported for route
 * handlers that need to gate on the host (e.g. returning 503 for an
 * unregistered one) without re-implementing header precedence.
 */
export function getRequestHostname(request: NextRequest): string {
  return normalizeHost(readRequestAuthority(request));
}

/**
 * The origin the request itself arrived on.
 *
 * Used by the Shopify-family routes (`/api/auth/login`, `/api/auth/callback`,
 * `/api/auth/logout`, `/{locale}/link`), which previously computed
 * `process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin`.
 *
 * ## Why these four keep the request origin instead of moving to getBaseUrl()
 *
 * Measured 2026-08-18 via `vercel env ls production` (names only; no values were
 * read): **`NEXT_PUBLIC_APP_URL` is not set in production.** So that expression
 * has always evaluated to `request.nextUrl.origin` there, and the premise behind
 * pinning these routes to the env chain — "NEXT_PUBLIC_* is inlined at build time
 * with one production value, so previews resolve to the production origin" —
 * does not hold for this project. There is nothing to mismatch.
 *
 * Repointing them at `NEXTAUTH_URL` would therefore not be a fix; it would be an
 * unforced change to the `redirect_uri` / `post_logout_redirect_uri` that Shopify
 * matches by exact string, made without being able to read Shopify's registered
 * list. So the origin source is left exactly as it was, the dead env branch is
 * dropped, and the actual protection is added in front of it as a host gate
 * (`isRegisteredAuthHost`) that is inert until `LINE_ALLOWED_CALLBACK_HOSTS` is
 * deliberately set. That keeps the rollback story honest: unset the variable and
 * behaviour returns to today's.
 *
 * ## Why this reads the Host header rather than `request.nextUrl.origin`
 *
 * `nextUrl.origin` reports the origin the SERVER is bound to, not the one the
 * user addressed. On Vercel those coincide, because the request URL is built
 * from the incoming Host — which is why the previous code worked in production.
 * They diverge the moment anything sits in front of the server: on the dev
 * server it is always `http://localhost:<port>` no matter what Host arrives
 * (measured 2026-08-18), so a user on `www.elxea.test:3310` was being redirected
 * to `localhost:3310` after logout.
 *
 * Reading the Host header therefore preserves production behaviour and fixes the
 * divergence, rather than the other way round. `nextUrl.origin` remains the
 * fallback for the case where no Host header is present at all.
 *
 * ## The host is validated before it is trusted (fail-closed)
 *
 * `Host` is an attacker-controlled header. This origin is used as a redirect
 * target (`/api/auth/logout` sends the user to `${origin}/${locale}` on its
 * local-completion branch), so echoing it back unchecked is an open redirect:
 * `Host: evil.example` would bounce the user off-site.
 *
 * An earlier revision claimed this was "gated by `isRegisteredAuthHost` at the
 * call site". It was not, as shipped — that gate is fail-OPEN while
 * `LINE_ALLOWED_CALLBACK_HOSTS` is unset, which it is in production, so nothing
 * validated the host at all. The claim also contradicted this codebase's own
 * stated position that no upstream host filtering may be assumed
 * (`lib/auth/cookies.ts`).
 *
 * So the check is made here and made unconditional: the host is used only when it
 * is recognised — at or under our own apex, or explicitly allow-listed. Anything
 * else falls back to `request.nextUrl.origin`, the origin the server is actually
 * bound to, which no header can influence. Production hosts are under the apex,
 * so this changes nothing there; an unrecognised host simply loses the ability to
 * steer a redirect.
 */
export function getRequestOrigin(request: NextRequest): string {
  const authority = readRequestAuthority(request);
  if (!authority) return request.nextUrl.origin;

  if (!isTrustedAuthHost(normalizeHost(authority))) return request.nextUrl.origin;

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const protocol =
    forwardedProto || request.nextUrl.protocol.replace(/:$/, "") || "https";
  return `${protocol}://${authority}`;
}
