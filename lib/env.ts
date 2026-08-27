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
 *
 * ## What is left here after Wave 1 (2026-08-27)
 *
 * The rule this file introduced was right; the migration onto it was never
 * finished. Three call sites adopted it and ~60 kept reading `process.env`
 * raw, which is how the LINE Channel Secret defect below still reached
 * production. Wave 1 moves the declaration of every variable into
 * `lib/config/spec.ts` and makes `process.env` unreachable outside
 * `lib/config/**` via lint, so the trim rules below are now applied **by
 * declaration** rather than by each caller remembering to call them.
 *
 * The `read*` helpers stay exported because `lib/config/spec.ts` states the
 * same three policies in schema form and several tests pin their behaviour
 * directly. Prefer `env("NAME")` from `@/lib/config` in new code.
 */

import { env } from "@/lib/config";
import { siteUrl } from "@/lib/site-url";

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

/**
 * Same trimming rule as {@link readEnvTrimmed}, but for values that must never
 * be substituted — credentials, channel ids, shared secrets.
 *
 * Returns `undefined` (not a fallback string) when the variable is unset or
 * trims down to nothing, so callers are forced to decide what "not configured"
 * means instead of quietly sending an empty or placeholder credential upstream.
 *
 * ## Why a credential needs trimming at all
 *
 * The stdin-pipe defect described at the top of this file lands on secrets too,
 * and there it is much harder to see: a Channel Secret with a trailing newline
 * is still 32 correct characters followed by one invisible one. It renders
 * identically in the Vercel dashboard and nothing warns you. It surfaces only
 * at the far end, as the provider's generic rejection.
 *
 * That is how the Web LINE linking flow broke in production on 2026-08-22.
 * `LINE_LOGIN_CHANNEL_SECRET` was stored as 32 chars + `\n`, so
 * `POST https://api.line.me/oauth2/v2.1/token` answered
 * `400 error=invalid_client error_description=invalid client_secret` on every
 * attempt and the customer was bounced back to the account page with
 * "連携を完了できませんでした". Email login kept working throughout, because it reads
 * a different (clean) variable for the same channel — which is why the failure
 * looked like a linking bug rather than a configuration one.
 */
export function readSecretEnvTrimmed(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Canonical public origin of the site, with no trailing slash. */
export { SITE_URL_FALLBACK } from "@/lib/config/spec";

/**
 * @deprecated Use `siteUrl()` from `@/lib/site-url` — that is the single
 * definition (`@sot site-origin`). This alias remains only so existing call
 * sites keep compiling.
 *
 * ## Why this became an alias
 *
 * This function and `siteUrl()` were two implementations of one concept with
 * **different rules**: this one trimmed only the edges, `siteUrl()` stripped
 * all whitespace. `lib/email/dunning.ts` and
 * `lib/email/subscription-reminder.ts` imported both. Collapsing onto the
 * stricter rule is a deliberate behaviour change: a value with interior
 * whitespace used to survive this path and now does not, which is the point —
 * that is the shape the broken production sitemap had.
 */
export function getSiteUrl(): string {
  return siteUrl();
}

/**
 * GTM container id, trimmed and reduced to the characters a container id can
 * legally contain (`GTM-XXXXXXX`). The value is interpolated into an inline
 * `<script>` and into a `googletagmanager.com` URL, so stray whitespace breaks
 * the tag and stray punctuation would be an injection sink.
 *
 * The trim now comes from the `NEXT_PUBLIC_GTM_ID` declaration in
 * `lib/config/spec.ts`; the character filter stays here because it is this
 * value's own rule rather than a general env rule.
 *
 * Returns `undefined` when unset/empty so callers can render nothing.
 */
export function getGtmId(): string | undefined {
  const id = (env("NEXT_PUBLIC_GTM_ID") ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return id === "" ? undefined : id;
}
