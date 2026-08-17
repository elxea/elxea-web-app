/**
 * Cookie-consent persistence.
 *
 * This module owns *where* the visitor's cookie choice is stored and *how* a
 * stored value is interpreted. It holds no React and no DOM rendering, so the
 * rules below are unit-testable without a browser.
 *
 * Why two stores (localStorage + a cookie):
 *
 * 1. `localStorage` is per-origin. `elxea.com` and `www.elxea.com` both serve
 *    the site (verified 2026-08-17: both return 200 for `/ja`, neither
 *    redirects to the other), so a choice made on one host is invisible on the
 *    other and the banner comes back. A cookie written with
 *    `domain=elxea.com` is shared by both hosts and closes that gap.
 * 2. `localStorage` access *throws* in storage-blocked contexts (Safari with
 *    all cookies blocked, some in-app browsers — this site is opened inside the
 *    LINE in-app browser for the LIFF linking flow). The previous
 *    implementation read it bare during render, so a throw took the whole page
 *    down. Every access here is guarded, with a per-session in-memory value as
 *    the last resort so the banner at least stays dismissed for that visit.
 */

export const CONSENT_STORAGE_KEY = "cookie-consent";
export const CONSENT_COOKIE_NAME = "cookie_consent";

/** 180 days. Long enough not to nag, short enough to re-ask within a year. */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/**
 * `all` = analytics/marketing allowed. `essential` = strictly necessary only,
 * which for this site means: no Google Tag Manager, no dataLayer pushes.
 */
export type ConsentChoice = "all" | "essential";

/**
 * Values that have ever been written by this site, plus the spellings a future
 * rewrite might plausibly use. Unknown values normalise to `null` (= "no valid
 * choice on record"), which re-shows the banner rather than guessing — guessing
 * wrong in the permissive direction would mean tracking without consent.
 */
const ACCEPT_ALIASES = new Set(["all", "accept", "accepted", "granted", "true", "yes", "1"]);
const ESSENTIAL_ALIASES = new Set([
  "essential",
  "necessary",
  "decline",
  "declined",
  "denied",
  "rejected",
  "false",
  "no",
  "0",
]);

export function normalizeConsentValue(raw: string | null | undefined): ConsentChoice | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (ACCEPT_ALIASES.has(value)) return "all";
  if (ESSENTIAL_ALIASES.has(value)) return "essential";
  return null;
}

/** Analytics may load only for an explicit "all". Unknown/未選択 is a no. */
export function isAnalyticsAllowed(choice: ConsentChoice | null | undefined): boolean {
  return choice === "all";
}

export function readConsentCookie(cookieString: string | null | undefined): string | null {
  if (!cookieString) return null;
  for (const part of cookieString.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== CONSENT_COOKIE_NAME) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * The widest domain we may safely claim for `hostname`.
 *
 * `www.elxea.com` -> `elxea.com` so apex and www share one choice. Anything
 * else keeps its own host (a preview deployment must not try to set a cookie on
 * `vercel.app`; browsers reject public suffixes anyway). Returns `null` when no
 * `domain` attribute should be sent at all (localhost, bare hostnames, IPs).
 */
export function consentCookieDomain(hostname: string | null | undefined): string | null {
  if (!hostname) return null;
  if (hostname.startsWith("[")) return null; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null; // IPv4 literal
  const bare = hostname.replace(/^www\./i, "");
  if (!bare.includes(".")) return null; // localhost, single-label hosts
  return bare;
}

export function buildConsentCookie(
  choice: ConsentChoice,
  options: { hostname?: string | null; secure?: boolean; maxAgeSeconds?: number } = {},
): string {
  const { hostname, secure = false, maxAgeSeconds = CONSENT_COOKIE_MAX_AGE_SECONDS } = options;
  const attributes = [
    `${CONSENT_COOKIE_NAME}=${choice}`,
    "path=/",
    `max-age=${maxAgeSeconds}`,
    "samesite=lax",
  ];
  const domain = consentCookieDomain(hostname);
  if (domain) attributes.push(`domain=${domain}`);
  if (secure) attributes.push("secure");
  return attributes.join("; ");
}

// --- browser wrappers -------------------------------------------------------
// Everything below touches `window`/`document` and is therefore guarded. The
// in-memory value keeps the choice alive for the current page session when both
// persistent stores are unavailable.

let memoryConsent: ConsentChoice | null = null;

function readLocalStorage(): string | null {
  try {
    return window.localStorage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readDocumentCookie(): string | null {
  try {
    return document.cookie;
  } catch {
    return null;
  }
}

/** The visitor's choice, or `null` when nothing valid is on record. */
export function readStoredConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  return (
    normalizeConsentValue(readLocalStorage()) ??
    normalizeConsentValue(readConsentCookie(readDocumentCookie())) ??
    memoryConsent
  );
}

/** Writes the choice everywhere it can be written. Never throws. */
export function persistConsent(choice: ConsentChoice): void {
  memoryConsent = choice;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // storage blocked or full — the cookie and the in-memory value still hold
  }
  try {
    document.cookie = buildConsentCookie(choice, {
      hostname: window.location.hostname,
      secure: window.location.protocol === "https:",
    });
  } catch {
    // cookies blocked — localStorage and the in-memory value still hold
  }
}

/** Test seam: drops the per-session fallback. Not used by the app. */
export function resetConsentMemoryForTests(): void {
  memoryConsent = null;
}
