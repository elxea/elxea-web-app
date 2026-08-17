import type { NextRequest } from "next/server";

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
