/**
 * A UUID v4 that also works outside a secure context.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts — https, or
 * localhost/127.0.0.1. Everywhere else it is simply absent, and calling it throws
 * `crypto.randomUUID is not a function`. Measured 2026-08-18 on
 * `http://www.elxea.test:3310`: `isSecureContext=false`, `hasRandomUUID=false`,
 * `hasSubtle=false`.
 *
 * That is not only a test-harness concern. Any deployment reached over plain
 * http — a LAN address during device testing, an internal preview host, a bare
 * IP — hits the same wall, and there the failure lands inside a React effect and
 * takes the chat provider down with it. Guarding the call site is a smaller
 * change than arranging TLS everywhere, and it fixes the real case as well as the
 * harness.
 *
 * `crypto.getRandomValues` is NOT restricted to secure contexts, so the fallback
 * keeps full cryptographic randomness; only the convenience wrapper is missing.
 * The last resort exists so this can never throw — an id that is merely unique
 * enough beats a crashed provider, and none of these ids is a security token.
 */
export function randomId(): string {
  const c: Crypto | undefined =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;

  if (typeof c?.randomUUID === "function") {
    return c.randomUUID();
  }

  if (typeof c?.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    // RFC 4122 section 4.4: pin the version (4) and variant (10xx) bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  const block = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  return [
    `${block()}${block()}`,
    block(),
    `4${block().slice(1)}`,
    `a${block().slice(1)}`,
    `${block()}${block()}${block()}`,
  ].join("-");
}
