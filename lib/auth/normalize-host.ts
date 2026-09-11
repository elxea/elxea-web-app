/**
 * Host-header normalisation, shared by the two modules that are allowed to make
 * host-based decisions: `lib/base-url.ts` (which origin do we hand to an IdP)
 * and `lib/auth/cookies.ts` (which Domain do we scope a cookie to).
 *
 * It lives in its own module rather than inside `cookies.ts` because
 * `base-url.ts` needs it too, and importing it from `cookies.ts` would make the
 * cookie-Domain module a dependency of origin resolution — two concerns the
 * design deliberately keeps apart ("both are separate functions with separate
 * rules; do not mix them"). This module knows nothing about the apex or about
 * cookies; it only normalises a string.
 *
 * Why normalisation is not optional: measured on a Next 16.2.1 probe,
 * `Host: WWW.ELXEA.TEST:3399` and `Host: www.elxea.test.:3399` both resolved to
 * a null cookie Domain, so the shared-domain deletion was never emitted and the
 * hole this work exists to close reproduced exactly. Case and the trailing root
 * dot are legal in a Host header; comparing raw strings against an apex is a
 * bug.
 */

/**
 * Reduce a raw `Host` / `X-Forwarded-Host` value to a bare, comparable hostname.
 *
 * - takes the first entry of a comma-separated relay list
 * - lowercases (Host is case-insensitive)
 * - strips the port
 * - strips one trailing dot (the FQDN absolute form `example.com.`)
 * - leaves an IPv6 literal in its bracketed form, `[::1]`
 *
 * Returns `""` for input that normalises to nothing, so callers can treat
 * "no usable host" as a single case.
 */
export function normalizeHost(raw: string): string {
  let h = raw.split(",")[0].trim().toLowerCase();

  // IPv6 literals are bracketed (`[::1]:3000`). The colons inside are part of
  // the address, so port-stripping by `split(":")` would destroy them.
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }

  h = h.split(":")[0];
  if (h.endsWith(".")) h = h.slice(0, -1);
  return h;
}
