/**
 * Defensive readers for environment variables.
 *
 * Why this exists: `vercel env add NAME production < file` (or any pipe that
 * feeds the value on stdin) stores the value **with the trailing newline**.
 * The variable then looks correct in every dashboard and log, but every
 * consumer that concatenates it produces a broken string:
 *
 *     `${process.env.NEXT_PUBLIC_SITE_URL}/ja`  ->  "https://elxea.com\n/ja"
 *
 * That exact defect shipped to production and broke all 172 `<loc>` entries in
 * `app/sitemap.ts` plus every link in the transactional emails
 * (`lib/email/*`), because each call site read `process.env` raw.
 * See deliverables/ga4-searchconsole-repair.md §2 (A).
 *
 * The fix is not "clean up the Vercel value once" — it is to make the code
 * immune to it, so a re-introduced newline can never reach a URL again.
 */

/**
 * Trim surrounding whitespace (spaces, tabs, CR, LF) off an env value and fall
 * back when the variable is unset or trims down to nothing.
 *
 * Takes the **value**, not the name, on purpose: Next.js inlines
 * `process.env.NEXT_PUBLIC_*` into client bundles by matching the literal
 * member expression at build time. A dynamic `process.env[name]` lookup would
 * silently become `undefined` in the browser.
 */
export function readEnvTrimmed(raw: string | undefined, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  return trimmed === "" ? fallback : trimmed;
}

/**
 * Same as {@link readEnvTrimmed}, and additionally drops trailing slashes so
 * that callers can always write `${base}/path` without producing `//path`.
 */
export function readUrlEnvTrimmed(raw: string | undefined, fallback: string): string {
  return readEnvTrimmed(raw, fallback).replace(/\/+$/, "");
}

/** Canonical public origin of the site, with no trailing slash. */
export const SITE_URL_FALLBACK = "https://elxea.com";

/**
 * The single accessor for `NEXT_PUBLIC_SITE_URL`.
 *
 * Every consumer (sitemap, email templates, cron routes) must go through this
 * rather than reading `process.env` directly, so the trim/normalisation rule
 * has exactly one definition.
 */
export function getSiteUrl(): string {
  return readUrlEnvTrimmed(process.env.NEXT_PUBLIC_SITE_URL, SITE_URL_FALLBACK);
}

/**
 * GTM container id, trimmed and reduced to the characters a container id can
 * legally contain (`GTM-XXXXXXX`). The value is interpolated into an inline
 * `<script>` and into a `googletagmanager.com` URL, so stray whitespace breaks
 * the tag and stray punctuation would be an injection sink.
 *
 * Returns `undefined` when unset/empty so callers can render nothing.
 */
export function getGtmId(): string | undefined {
  const id = readEnvTrimmed(process.env.NEXT_PUBLIC_GTM_ID, "").replace(
    /[^A-Za-z0-9_-]/g,
    ""
  );
  return id === "" ? undefined : id;
}
