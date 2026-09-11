/**
 * Tests for the in-memory rate limiter.
 *
 * Covers:
 *   - consume() sliding-window correctness across repeated calls
 *   - window expiry
 *   - separate bucket isolation (different limiters / different keys)
 *   - getClientIp() proxy header precedence and fallback hash
 *   - enforceRateLimit() 429 response shape + headers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  consume,
  enforceRateLimit,
  getClientIp,
  limiters,
  millisecondsToDuration,
  type Ratelimiter,
} from "@/lib/ratelimit";

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.test/api/x", {
    method: "GET",
    headers,
  });
}

// Use a unique limiter name per test to avoid cross-test bucket leakage.
let seq = 0;
function fresh(limit: number, windowMs: number): Ratelimiter {
  seq += 1;
  return { name: `test-limiter-${seq}`, limit, windowMs };
}

describe("consume", () => {
  it("allows up to `limit` requests inside the window", () => {
    const lim = fresh(3, 10_000);
    const r1 = consume(lim, "user-a");
    const r2 = consume(lim, "user-a");
    const r3 = consume(lim, "user-a");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("rejects the (limit+1)-th request with retryAfter>0", () => {
    const lim = fresh(2, 10_000);
    consume(lim, "user-b");
    consume(lim, "user-b");
    const r = consume(lim, "user-b");
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfter).toBeGreaterThan(0);
  });

  it("isolates distinct keys inside the same limiter", () => {
    const lim = fresh(1, 10_000);
    expect(consume(lim, "key-x").ok).toBe(true);
    // key-x exhausted
    expect(consume(lim, "key-x").ok).toBe(false);
    // key-y is independent
    expect(consume(lim, "key-y").ok).toBe(true);
  });

  it("isolates distinct limiters for the same key", () => {
    const a = fresh(1, 10_000);
    const b = fresh(1, 10_000);
    expect(consume(a, "k").ok).toBe(true);
    expect(consume(b, "k").ok).toBe(true);
    expect(consume(a, "k").ok).toBe(false);
  });

  it("releases capacity after the window elapses", () => {
    vi.useFakeTimers();
    try {
      const lim = fresh(1, 1000);
      const start = 1_000_000;
      vi.setSystemTime(start);
      expect(consume(lim, "w").ok).toBe(true);
      expect(consume(lim, "w").ok).toBe(false);
      // Advance past the window
      vi.setSystemTime(start + 1500);
      expect(consume(lim, "w").ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getClientIp", () => {
  it("prefers x-forwarded-for first entry", () => {
    const req = makeReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const req = makeReq({ "x-real-ip": "9.9.9.9" });
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it("falls back to x-vercel-forwarded-for", () => {
    const req = makeReq({ "x-vercel-forwarded-for": "11.22.33.44" });
    expect(getClientIp(req)).toBe("11.22.33.44");
  });

  it("uses a deterministic hash fallback when no IP header is present", () => {
    const req = makeReq({
      "user-agent": "Mozilla/5.0 Test",
      "accept-language": "ja-JP",
    });
    const ip = getClientIp(req);
    expect(ip.startsWith("fallback-")).toBe(true);
    // Same header set should produce the same key.
    const ip2 = getClientIp(
      makeReq({
        "user-agent": "Mozilla/5.0 Test",
        "accept-language": "ja-JP",
      })
    );
    expect(ip2).toBe(ip);
  });

  it("produces different hash fallbacks for different headers", () => {
    const a = getClientIp(makeReq({ "user-agent": "A" }));
    const b = getClientIp(makeReq({ "user-agent": "B" }));
    expect(a).not.toBe(b);
  });
});

describe("enforceRateLimit", () => {
  it("returns null while under the limit", async () => {
    const lim = fresh(5, 10_000);
    const req = makeReq();
    const resp = await enforceRateLimit(req, lim, "eu-key");
    expect(resp).toBeNull();
  });

  it("returns a 429 Response with Retry-After when over the limit", async () => {
    const lim = fresh(1, 10_000);
    const req = makeReq();
    // First request: allowed
    expect(await enforceRateLimit(req, lim, "over-key")).toBeNull();
    // Second request: blocked
    const resp = await enforceRateLimit(req, lim, "over-key");
    expect(resp).not.toBeNull();
    if (resp) {
      expect(resp.status).toBe(429);
      expect(resp.headers.get("Retry-After")).toBeTruthy();
      expect(resp.headers.get("RateLimit-Limit")).toBe("1");
      expect(resp.headers.get("RateLimit-Remaining")).toBe("0");
      const body = await resp.json();
      expect(body.error).toBe("Too Many Requests");
      expect(typeof body.retryAfter).toBe("number");
    }
  });
});

describe("exported limiter presets", () => {
  it("defines the expected shapes", () => {
    expect(limiters.authedUser.limit).toBe(100);
    expect(limiters.authedUser.windowMs).toBe(60 * 1000);
    expect(limiters.contactForm.limit).toBe(10);
    expect(limiters.contactForm.windowMs).toBe(60 * 60 * 1000);
    expect(limiters.publicRead.limit).toBe(300);
    expect(limiters.publicRead.windowMs).toBe(60 * 1000);
  });

  it("routes authedUser and contactForm through upstash, publicRead through memory", () => {
    expect(limiters.authedUser.backend).toBe("upstash");
    expect(limiters.contactForm.backend).toBe("upstash");
    expect(limiters.publicRead.backend).toBe("memory");
  });
});

describe("millisecondsToDuration", () => {
  it("converts whole days to d", () => {
    expect(millisecondsToDuration(24 * 60 * 60 * 1000)).toBe("1 d");
    expect(millisecondsToDuration(2 * 24 * 60 * 60 * 1000)).toBe("2 d");
  });

  it("converts whole hours to h", () => {
    expect(millisecondsToDuration(60 * 60 * 1000)).toBe("1 h");
    expect(millisecondsToDuration(12 * 60 * 60 * 1000)).toBe("12 h");
  });

  it("converts whole minutes to m", () => {
    expect(millisecondsToDuration(60 * 1000)).toBe("1 m");
    expect(millisecondsToDuration(5 * 60 * 1000)).toBe("5 m");
  });

  it("converts residual seconds to s", () => {
    expect(millisecondsToDuration(30 * 1000)).toBe("30 s");
    expect(millisecondsToDuration(90 * 1000)).toBe("90 s");
  });

  it("throws on sub-second windows to prevent silent window expansion", () => {
    expect(() => millisecondsToDuration(500)).toThrow(/windowMs must be >= 1000/);
    expect(() => millisecondsToDuration(0)).toThrow();
    expect(() => millisecondsToDuration(999)).toThrow();
  });

  it("accepts exactly 1 second", () => {
    expect(millisecondsToDuration(1000)).toBe("1 s");
  });
});
