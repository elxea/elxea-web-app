/**
 * Rate limiting helper.
 *
 * ## Backend selection
 *
 * Per-limiter opt-in to Upstash. Each `Ratelimiter` has a `backend` field:
 *   - `"upstash"` — use `@upstash/ratelimit` + Redis when env vars are set,
 *     otherwise fall back to in-memory (with a warning in production).
 *   - `"memory"` — always use in-memory, regardless of env vars.
 *
 * The per-limiter choice is driven by cost: Upstash Free plan caps daily
 * commands, so we route only security-critical limiters (authed-user,
 * contact-form) through Upstash. High-volume non-critical limiters
 * (public-read) stay in-memory to avoid burning the command budget.
 *
 * ## Failure semantics
 *
 * When Upstash is unreachable the limiter **degrades to the in-memory
 * backend** rather than failing open. Per-instance counting is weaker than
 * shared counting, but it is strictly better than serving with no gate at
 * all — which is what a bare fail-open does on a *sustained* outage (e.g.
 * the Redis instance being deleted, leaving the hostname NXDOMAIN).
 *
 * A circuit breaker stops re-dialing a known-dead Upstash on every request:
 * after `UPSTASH_FAILURE_THRESHOLD` consecutive failures the breaker opens
 * for `UPSTASH_COOLDOWN_MS`, during which requests go straight to memory.
 * After the cooldown a single half-open probe decides whether to close.
 * Without this, every authed/contact request pays a failed DNS lookup.
 *
 * ## Semantics note
 *
 * `@upstash/ratelimit`'s `slidingWindow` is an **approximated** sliding
 * window: it combines the current fixed window and the previous window
 * with a time-weighted proportion. Counts near window boundaries can
 * temporarily exceed `limit` by up to 2x under burst conditions. This is
 * acceptable for defensive rate limiting; for a strict enforce-limit
 * semantics, use `fixedWindow` on the Upstash side.
 *
 * References:
 *   - https://upstash.com/docs/oss/sdks/ts/ratelimit/overview
 */

import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import * as Sentry from "@sentry/nextjs";
import crypto from "crypto";
import { env, isProduction, isTest } from "@/lib/config";

export interface Ratelimiter {
  name: string;
  limit: number;
  windowMs: number;
  /**
   * `"upstash"`: use shared Redis when configured, fall back to in-memory
   *              if env vars missing.
   * `"memory"`:  always in-memory. Use for high-volume non-critical paths
   *              to preserve Upstash Free plan command budget.
   *
   * Optional for backwards compatibility with tests that construct a
   * `Ratelimiter` inline. Defaults to `"memory"` when omitted.
   */
  backend?: "upstash" | "memory";
}

// ---------------------------------------------------------------------------
// Env detection
// ---------------------------------------------------------------------------

// Trimming defends against accidental whitespace / newline in env var values
// (common when env vars are set via `echo "$v" | vercel env add ...` which
// appends a trailing newline). Upstash Redis client rejects whitespace, so the
// value is normalized rather than failing at module load — both variables are
// declared `optionalTrimmed` in `lib/config/spec.ts`, which also maps a
// blank value to `undefined` (the same "unset" semantics as before).
const UPSTASH_URL = env("UPSTASH_REDIS_REST_URL");
const UPSTASH_TOKEN = env("UPSTASH_REDIS_REST_TOKEN");
const USE_UPSTASH = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// Detect partial (broken) Upstash configuration. Setting one without the
// other is almost certainly a config mistake; silently falling through to
// in-memory would mask it in production.
if (!USE_UPSTASH && (UPSTASH_URL || UPSTASH_TOKEN)) {
  const missing = !UPSTASH_URL ? "UPSTASH_REDIS_REST_URL" : "UPSTASH_REDIS_REST_TOKEN";
  console.error(
    `[ratelimit] Partial Upstash configuration: ${missing} is missing. ` +
      `Both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required. ` +
      `Falling back to in-memory.`
  );
}

// In production, warn if an Upstash-intended limiter cannot reach Upstash.
if (!USE_UPSTASH && isProduction()) {
  console.warn(
    `[ratelimit] Running in production without Upstash. Counters are per-instance only; ` +
      `concurrent requests across Vercel serverless instances can exceed configured limits.`
  );
}

// ---------------------------------------------------------------------------
// Upstash client and limiter cache
// ---------------------------------------------------------------------------

const redis = USE_UPSTASH
  ? new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! })
  : null;

const upstashLimiters = new Map<string, Ratelimit>();

/**
 * Minimal surface the enforcement path needs from an Upstash limiter.
 * Declared structurally so tests can substitute a fake without pulling in
 * the real `Ratelimit` class.
 */
export interface UpstashLike {
  limit(key: string): Promise<{
    success: boolean;
    remaining: number;
    reset: number;
  }>;
}

/**
 * Indirection point for the Upstash limiter lookup. Production uses
 * `getUpstashLimiter`; tests swap this to exercise the failure/degradation
 * path without a live Redis. See `__setUpstashResolverForTests`.
 */
let resolveUpstash: (limiter: Ratelimiter) => UpstashLike | null =
  getUpstashLimiter;

function getUpstashLimiter(limiter: Ratelimiter): Ratelimit | null {
  if (!redis) return null;
  let inst = upstashLimiters.get(limiter.name);
  if (inst) return inst;
  inst = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(
      limiter.limit,
      millisecondsToDuration(limiter.windowMs)
    ),
    analytics: false, // stay within Free plan command budget
    // `ratelimit:elxea-web:<name>` prefix to avoid collision with any other
    // app sharing this Upstash instance in the future.
    prefix: `ratelimit:elxea-web:${limiter.name}`,
  });
  upstashLimiters.set(limiter.name, inst);
  return inst;
}

/**
 * Convert a millisecond window into the `${n} ${unit}` string format that
 * `@upstash/ratelimit`'s `slidingWindow()` expects. Picks the largest unit
 * that divides cleanly for a human-readable Redis TTL.
 *
 * @throws if `ms < 1000`. Sub-second windows round up to `1 s`, which would
 *         silently double (or more) the intended window size.
 */
export function millisecondsToDuration(
  ms: number
): `${number} ${"s" | "m" | "h" | "d"}` {
  if (ms < 1000) {
    throw new Error(
      `millisecondsToDuration: windowMs must be >= 1000ms (got ${ms})`
    );
  }
  if (ms % (24 * 60 * 60 * 1000) === 0)
    return `${ms / (24 * 60 * 60 * 1000)} d` as const;
  if (ms % (60 * 60 * 1000) === 0)
    return `${ms / (60 * 60 * 1000)} h` as const;
  if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)} m` as const;
  return `${Math.round(ms / 1000)} s` as const;
}

// ---------------------------------------------------------------------------
// Upstash circuit breaker
// ---------------------------------------------------------------------------

/** Consecutive failures before the breaker opens. */
const UPSTASH_FAILURE_THRESHOLD = 3;
/** How long the breaker stays open before allowing a half-open probe. */
const UPSTASH_COOLDOWN_MS = 30_000;

let upstashConsecutiveFailures = 0;
/** Epoch ms until which the breaker is open. `0` means closed. */
let upstashOpenUntil = 0;
let upstashHalfOpen = false;
/** Ensures one Sentry event per outage per instance, not one per request. */
let upstashOutageReported = false;

/** True when the enforcement path may attempt Upstash. */
function upstashCircuitAllows(): boolean {
  if (upstashOpenUntil === 0) return true;
  if (Date.now() < upstashOpenUntil) return false;
  // Cooldown elapsed: let exactly one request through as a probe.
  upstashHalfOpen = true;
  return true;
}

function onUpstashSuccess(): void {
  if (upstashOutageReported) {
    console.log(
      `[ratelimit] Upstash reachable again; resuming shared counters.`
    );
  }
  upstashConsecutiveFailures = 0;
  upstashOpenUntil = 0;
  upstashHalfOpen = false;
  upstashOutageReported = false;
}

function onUpstashFailure(
  limiter: Ratelimiter,
  keyHash: string,
  err: unknown
): void {
  upstashConsecutiveFailures += 1;
  const wasHalfOpen = upstashHalfOpen;
  upstashHalfOpen = false;

  // A failed half-open probe re-opens immediately; otherwise wait for the
  // threshold so a single transient blip does not disable shared counting.
  if (wasHalfOpen || upstashConsecutiveFailures >= UPSTASH_FAILURE_THRESHOLD) {
    upstashOpenUntil = Date.now() + UPSTASH_COOLDOWN_MS;
  }

  if (!upstashOutageReported) {
    upstashOutageReported = true;
    console.error(
      `[ratelimit] Upstash limit() failed for ${limiter.name}:${keyHash}; ` +
        `degrading to in-memory counters (per-instance).`,
      err
    );
    Sentry.captureException(err, {
      tags: { subsystem: "ratelimit", limiter: limiter.name },
      extra: { keyHash, degradedTo: "memory" },
    });
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

interface Entry {
  timestamps: number[];
}

const buckets = new Map<string, Map<string, Entry>>();

/**
 * Consume one request for the given limiter and key using the in-memory
 * backend. Exported for tests.
 */
export function consume(
  limiter: Ratelimiter,
  key: string
): {
  ok: boolean;
  remaining: number;
  reset: number;
  retryAfter: number;
} {
  const now = Date.now();
  const windowStart = now - limiter.windowMs;

  let bucket = buckets.get(limiter.name);
  if (!bucket) {
    bucket = new Map();
    buckets.set(limiter.name, bucket);
  }

  const entry = bucket.get(key) ?? { timestamps: [] };
  const fresh = entry.timestamps.filter((t) => t > windowStart);

  if (fresh.length >= limiter.limit) {
    const oldest = fresh[0]!;
    const resetMs = oldest + limiter.windowMs;
    const retryAfterSec = Math.max(1, Math.ceil((resetMs - now) / 1000));
    bucket.set(key, { timestamps: fresh });
    return {
      ok: false,
      remaining: 0,
      reset: Math.ceil(resetMs / 1000),
      retryAfter: retryAfterSec,
    };
  }

  fresh.push(now);
  bucket.set(key, { timestamps: fresh });

  const resetMs = (fresh[0] ?? now) + limiter.windowMs;
  return {
    ok: true,
    remaining: Math.max(0, limiter.limit - fresh.length),
    reset: Math.ceil(resetMs / 1000),
    retryAfter: 0,
  };
}

// ---------------------------------------------------------------------------
// Client IP derivation
// ---------------------------------------------------------------------------

export function getClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  const vercelFwd = request.headers.get("x-vercel-forwarded-for");
  if (vercelFwd) {
    const first = vercelFwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const ua = request.headers.get("user-agent") ?? "";
  const lang = request.headers.get("accept-language") ?? "";
  let h = 2166136261;
  const s = ua + "|" + lang;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return `fallback-${(h >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------
// Limiter definitions
// ---------------------------------------------------------------------------

export const limiters = {
  authedUser: {
    name: "authed-user",
    limit: 100,
    windowMs: 60 * 1000,
    backend: "upstash",
  } satisfies Ratelimiter,
  contactForm: {
    name: "contact-form",
    limit: 10,
    windowMs: 60 * 60 * 1000,
    backend: "upstash",
  } satisfies Ratelimiter,
  // public-read stays in-memory: 300/min/IP × realistic traffic would burn
  // the Upstash Free plan command budget (10k/day). Non-critical path, so
  // per-instance counting is acceptable for now.
  publicRead: {
    name: "public-read",
    limit: 300,
    windowMs: 60 * 1000,
    backend: "memory",
  } satisfies Ratelimiter,
} as const;

// ---------------------------------------------------------------------------
// In-memory cleanup (prevents leak when fallback is active)
// ---------------------------------------------------------------------------

const CLEANUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanupAt = 0;
const MAX_WINDOW_MS = 60 * 60 * 1000;

function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
  lastCleanupAt = now;

  const cutoff = now - MAX_WINDOW_MS;
  for (const [name, bucket] of buckets) {
    for (const [key, entry] of bucket) {
      const newest = entry.timestamps[entry.timestamps.length - 1] ?? 0;
      if (newest < cutoff) {
        bucket.delete(key);
      }
    }
    if (bucket.size === 0) buckets.delete(name);
  }
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

/**
 * Hash a rate-limit key for log output. Avoids leaking raw customerId /
 * IP addresses into function logs (PII). 8-char sha256 prefix gives enough
 * disambiguation for debugging while being irreversible.
 */
function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex").substring(0, 8);
}

/**
 * Enforce a rate limit on an incoming request. On rejection, returns a 429
 * NextResponse with Retry-After + RateLimit-* headers. On success, returns
 * null (the caller should continue handling).
 *
 * Upstash errors do **not** fail open. Rate limiting is defensive, so 503ing
 * legitimate traffic on transient Redis unavailability would be wrong — but
 * so is dropping the gate entirely. Instead the request falls through to the
 * in-memory backend, which still bounds a single caller per instance. Errors
 * are reported to Sentry (once per outage per instance) so sustained Upstash
 * outages stay visible to ops.
 */
export async function enforceRateLimit(
  _request: NextRequest,
  limiter: Ratelimiter,
  key: string
): Promise<NextResponse | null> {
  // Default to "memory" when backend is unspecified (backwards compat).
  const backend = limiter.backend ?? "memory";
  const upstash =
    backend === "upstash" && upstashCircuitAllows()
      ? resolveUpstash(limiter)
      : null;

  let outcome: {
    ok: boolean;
    remaining: number;
    reset: number; // unix seconds
    retryAfter: number; // seconds until retry succeeds
  } | null = null;

  if (upstash) {
    try {
      const result = await upstash.limit(key);
      onUpstashSuccess();
      outcome = {
        ok: result.success,
        remaining: result.remaining,
        reset: Math.ceil(result.reset / 1000),
        retryAfter: result.success
          ? 0
          : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
      };
    } catch (err) {
      onUpstashFailure(limiter, hashKey(key), err);
      // Fall through to the in-memory backend below.
    }
  }

  if (!outcome) {
    maybeCleanup();
    outcome = consume(limiter, key);
  }

  const { ok, remaining, reset, retryAfter } = outcome;

  if (ok) return null;

  return NextResponse.json(
    {
      error: "Too Many Requests",
      retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "RateLimit-Limit": String(limiter.limit),
        "RateLimit-Remaining": String(remaining),
        "RateLimit-Reset": String(reset),
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Test-only hooks
// ---------------------------------------------------------------------------

/**
 * Substitute the Upstash limiter lookup. Pass `null` to restore the real one.
 * Test-only: production code must never call this.
 */
export function __setUpstashResolverForTests(
  fn: ((limiter: Ratelimiter) => UpstashLike | null) | null
): void {
  resolveUpstash = fn ?? getUpstashLimiter;
}

/** Reset circuit-breaker state between tests. Test-only. */
export function __resetUpstashCircuitForTests(): void {
  upstashConsecutiveFailures = 0;
  upstashOpenUntil = 0;
  upstashHalfOpen = false;
  upstashOutageReported = false;
}

/** Inspect circuit-breaker state. Test-only. */
export function __getUpstashCircuitStateForTests(): {
  consecutiveFailures: number;
  open: boolean;
  outageReported: boolean;
} {
  return {
    consecutiveFailures: upstashConsecutiveFailures,
    open: upstashOpenUntil !== 0 && Date.now() < upstashOpenUntil,
    outageReported: upstashOutageReported,
  };
}

// Startup signal. Log once so ops knows which backend is active per
// deployment. Skipped in test env to keep test output clean.
if (!isTest()) {
  const upstashPaths = Object.values(limiters)
    .filter((l) => l.backend === "upstash")
    .map((l) => l.name);
  const memoryPaths = Object.values(limiters)
    .filter((l) => l.backend === "memory")
    .map((l) => l.name);
  const upstashStatus = USE_UPSTASH ? "configured" : "NOT configured (fallback)";
  console.log(
    `[ratelimit] upstash=${upstashStatus}; upstash-limiters=[${upstashPaths.join(",")}]; memory-limiters=[${memoryPaths.join(",")}]`
  );
}
