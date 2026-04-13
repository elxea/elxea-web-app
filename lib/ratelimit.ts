/**
 * Rate limiting helper.
 *
 * CURRENT IMPLEMENTATION: In-memory sliding-window limiter.
 *
 * TODO: Replace with a distributed limiter (Vercel KV or Upstash Ratelimit)
 * before production launch. The in-memory implementation is:
 *   - Per-instance only (each Vercel serverless invocation has its own map)
 *   - Lost on cold start
 *   - Ineffective for scaled deployments
 *
 * It is useful as a coarse-grained safety net during development and early
 * traffic, and as a structural placeholder so routes already carry the
 * limiting call-sites when we swap in the real backend.
 *
 * To swap for @upstash/ratelimit + @upstash/redis:
 *   1. `pnpm add @upstash/ratelimit @upstash/redis`
 *   2. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars
 *   3. Replace the `consume` implementation below with a Ratelimit.limit()
 *      call keyed by `${limiter.name}:${key}`.
 *
 * References:
 *   - https://upstash.com/docs/oss/sdks/ts/ratelimit/overview
 *   - https://vercel.com/docs/storage/vercel-kv
 */

import { NextRequest, NextResponse } from "next/server";

export interface Ratelimiter {
  name: string;
  limit: number;
  windowMs: number;
}

interface Entry {
  timestamps: number[];
}

// Bucket: limiter name -> key -> entry
const buckets = new Map<string, Map<string, Entry>>();

/**
 * Consume one request for the given limiter and key.
 * Returns `{ ok: true, remaining, reset }` or `{ ok: false, retryAfter, reset }`.
 */
export function consume(
  limiter: Ratelimiter,
  key: string
): {
  ok: boolean;
  remaining: number;
  reset: number; // unix seconds when window will have space again
  retryAfter: number; // seconds until a retry will succeed (0 if ok)
} {
  const now = Date.now();
  const windowStart = now - limiter.windowMs;

  let bucket = buckets.get(limiter.name);
  if (!bucket) {
    bucket = new Map();
    buckets.set(limiter.name, bucket);
  }

  const entry = bucket.get(key) ?? { timestamps: [] };
  // Drop timestamps outside the window.
  const fresh = entry.timestamps.filter((t) => t > windowStart);

  if (fresh.length >= limiter.limit) {
    // Window is full. The oldest request must age out.
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

/**
 * Derive a rate-limit key for an incoming request from the best available
 * client identifier. Honors:
 *   1. x-forwarded-for (Vercel, most proxies)
 *   2. x-real-ip (nginx)
 *   3. x-vercel-forwarded-for (Vercel Edge)
 *
 * If no proxy header is present (e.g. direct dev traffic, misconfigured
 * proxy), we avoid the "unknown" catch-all bucket — that would cause a
 * single abusive client to exhaust the limit for every unauthenticated
 * caller. Instead, bucket by user-agent hash + accept-language so
 * unidentified clients share only with near-identical siblings. This is
 * NOT cryptographically secure (a client can rotate headers) but it is a
 * strict improvement over `"unknown"` as a global bucket key.
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
  // Short synchronous non-crypto hash keeps this O(1) and avoids pulling in
  // node:crypto for a path that runs per request.
  let h = 2166136261;
  const s = ua + "|" + lang;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return `fallback-${(h >>> 0).toString(16)}`;
}

/**
 * Shared limiter definitions used across the API.
 */
export const limiters = {
  authedUser: {
    name: "authed-user",
    limit: 100,
    windowMs: 60 * 1000, // 100 requests / minute / user
  } satisfies Ratelimiter,
  contactForm: {
    name: "contact-form",
    limit: 10,
    windowMs: 60 * 60 * 1000, // 10 requests / hour / IP
  } satisfies Ratelimiter,
  publicRead: {
    name: "public-read",
    limit: 300,
    windowMs: 60 * 1000, // 300 requests / minute / IP for public GET endpoints
  } satisfies Ratelimiter,
} as const;

/**
 * Periodically drop stale entries from the in-memory buckets.
 *
 * The limiter accumulates one Map entry per unique (limiter, key) pair.
 * Without cleanup, long-running instances leak memory as keys (customerIds,
 * IPs) churn. We run a wall-clock-gated sweep at most once every
 * CLEANUP_MIN_INTERVAL_MS so the amortized cost is bounded regardless of
 * request rate, and high-traffic instances do not pay O(n) on every request.
 *
 * The eventual Upstash/KV replacement will delegate TTL to Redis and this
 * helper can be deleted.
 */
const CLEANUP_MIN_INTERVAL_MS = 5 * 60 * 1000; // at most one sweep every 5 min
let lastCleanupAt = 0;
const MAX_WINDOW_MS = 60 * 60 * 1000; // match the longest configured window

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

/**
 * Enforce a rate limit on an incoming request. On rejection, returns a 429
 * NextResponse with Retry-After + RateLimit-* headers. On success, returns
 * null (the caller should continue handling).
 *
 * @example
 * ```ts
 * const limited = enforceRateLimit(request, limiters.authedUser, auth.customerId);
 * if (limited) return limited;
 * ```
 */
export async function enforceRateLimit(
  _request: NextRequest,
  limiter: Ratelimiter,
  key: string
): Promise<NextResponse | null> {
  // Declared async so the interface is forward-compatible with the Upstash
  // / Vercel KV distributed limiter, whose `limit()` returns a Promise.
  // The in-memory body below is synchronous, but every call site already
  // awaits — swapping the implementation is a no-touch change.
  maybeCleanup();
  const result = consume(limiter, key);
  if (result.ok) return null;

  return NextResponse.json(
    {
      error: "Too Many Requests",
      retryAfter: result.retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfter),
        "RateLimit-Limit": String(limiter.limit),
        "RateLimit-Remaining": String(result.remaining),
        "RateLimit-Reset": String(result.reset),
      },
    }
  );
}
