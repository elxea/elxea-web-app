/**
 * Rate limiting helper.
 *
 * Backend selection at module load time:
 *   - If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set,
 *     `@upstash/ratelimit` with Redis is used. Counters are shared across
 *     all Vercel serverless instances, so concurrency-based bypass attacks
 *     are prevented.
 *   - Otherwise, an in-memory sliding-window limiter runs per-instance.
 *     This is a development/fallback mode; limits are NOT enforced globally.
 *
 * The `enforceRateLimit` interface is stable across backends, so call sites
 * never change when credentials are added or removed.
 *
 * References:
 *   - https://upstash.com/docs/oss/sdks/ts/ratelimit/overview
 */

import { NextRequest, NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface Ratelimiter {
  name: string;
  limit: number;
  windowMs: number;
}

// ---------------------------------------------------------------------------
// Backend detection
// ---------------------------------------------------------------------------

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_UPSTASH = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// Lazy: only construct Redis client when Upstash is configured. Skipping
// this when env vars are missing means tests and local dev without Upstash
// continue to work via the in-memory fallback.
const redis = USE_UPSTASH
  ? new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! })
  : null;

// Map of `limiter.name` -> Upstash Ratelimit instance. We cache per-name so
// we don't construct a new `Ratelimit` on every request.
const upstashLimiters = new Map<string, Ratelimit>();

function getUpstashLimiter(limiter: Ratelimiter): Ratelimit | null {
  if (!redis) return null;
  let inst = upstashLimiters.get(limiter.name);
  if (inst) return inst;
  inst = new Ratelimit({
    redis,
    // Sliding window with `limiter.limit` requests per `windowMs` interval.
    // Upstash expresses windows as e.g. "1 m", "1 h"; we translate from ms.
    limiter: Ratelimit.slidingWindow(limiter.limit, millisecondsToDuration(limiter.windowMs)),
    analytics: false, // stay under free-plan command budget
    prefix: `ratelimit:${limiter.name}`,
  });
  upstashLimiters.set(limiter.name, inst);
  return inst;
}

/**
 * Convert a millisecond window into the `${n} ${unit}` string format that
 * `@upstash/ratelimit`'s slidingWindow() expects. We pick the largest unit
 * that divides cleanly to keep the Redis key TTL human-readable.
 */
function millisecondsToDuration(ms: number): `${number} ${"s" | "m" | "h" | "d"}` {
  if (ms % (24 * 60 * 60 * 1000) === 0) return `${ms / (24 * 60 * 60 * 1000)} d` as const;
  if (ms % (60 * 60 * 1000) === 0) return `${ms / (60 * 60 * 1000)} h` as const;
  if (ms % (60 * 1000) === 0) return `${ms / (60 * 1000)} m` as const;
  return `${Math.max(1, Math.round(ms / 1000))} s` as const;
}

// ---------------------------------------------------------------------------
// In-memory fallback (dev / tests / unconfigured environments)
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

/**
 * Derive a rate-limit key for an incoming request from the best available
 * client identifier. Avoids a global "unknown" catch-all by hashing UA +
 * Accept-Language when no proxy header is present.
 */
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
  } satisfies Ratelimiter,
  contactForm: {
    name: "contact-form",
    limit: 10,
    windowMs: 60 * 60 * 1000,
  } satisfies Ratelimiter,
  publicRead: {
    name: "public-read",
    limit: 300,
    windowMs: 60 * 1000,
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
 * Enforce a rate limit on an incoming request. On rejection, returns a 429
 * NextResponse with Retry-After + RateLimit-* headers. On success, returns
 * null (the caller should continue handling).
 */
export async function enforceRateLimit(
  _request: NextRequest,
  limiter: Ratelimiter,
  key: string
): Promise<NextResponse | null> {
  const upstash = getUpstashLimiter(limiter);

  let ok: boolean;
  let remaining: number;
  let reset: number; // unix seconds
  let retryAfter: number; // seconds until retry succeeds

  if (upstash) {
    // Upstash path. `limit()` performs a single atomic Redis round-trip and
    // returns normalized state. If Redis is unreachable, we log and fail
    // open (null) — rate limiting is defensive, not a hard gate, so letting
    // legitimate traffic through is safer than 503'ing on a flaky network.
    try {
      const result = await upstash.limit(key);
      ok = result.success;
      remaining = result.remaining;
      reset = Math.ceil(result.reset / 1000);
      retryAfter = ok ? 0 : Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
    } catch (err) {
      console.error(
        `[ratelimit] Upstash limit() failed for ${limiter.name}:${key}; failing open.`,
        err
      );
      return null;
    }
  } else {
    // In-memory fallback. Warns once at module load if this branch is used
    // in production-like environments.
    maybeCleanup();
    const result = consume(limiter, key);
    ok = result.ok;
    remaining = result.remaining;
    reset = result.reset;
    retryAfter = result.retryAfter;
  }

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

// Startup signal: log which backend is in use so ops knows at a glance.
// This runs once when the module is first imported.
if (process.env.NODE_ENV !== "test") {
  const backend = USE_UPSTASH ? "upstash-redis" : "in-memory (per-instance)";
  console.log(`[ratelimit] backend=${backend}`);
}
