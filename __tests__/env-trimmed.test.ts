import { describe, it, expect, afterEach, vi } from "vitest";

import {
  readEnvTrimmed,
  readSecretEnvTrimmed,
  readUrlEnvTrimmed,
  getSiteUrl,
  getGtmId,
  SITE_URL_FALLBACK,
} from "@/lib/env";

/**
 * Regression guard for the production defect where `NEXT_PUBLIC_SITE_URL` was
 * stored on Vercel with a trailing newline, so every generated URL came out as
 * "https://elxea.com\n/ja" — all 172 sitemap <loc> entries and every link in
 * the transactional emails.
 * See deliverables/ga4-searchconsole-repair.md §2 (A).
 */

// The exact shape of the value that shipped: `vercel env add` keeps the
// trailing newline when the value arrives on stdin.
const POLLUTED = "https://elxea.com\n";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readEnvTrimmed", () => {
  it("strips a trailing newline", () => {
    expect(readEnvTrimmed("https://elxea.com\n", "fb")).toBe("https://elxea.com");
  });

  it("strips CRLF, tabs and surrounding spaces", () => {
    expect(readEnvTrimmed("  https://elxea.com\r\n\t ", "fb")).toBe(
      "https://elxea.com"
    );
  });

  it("falls back when unset", () => {
    expect(readEnvTrimmed(undefined, "fb")).toBe("fb");
  });

  it("falls back when the value is empty or whitespace-only", () => {
    expect(readEnvTrimmed("", "fb")).toBe("fb");
    expect(readEnvTrimmed("\n", "fb")).toBe("fb");
    expect(readEnvTrimmed("   \t\r\n ", "fb")).toBe("fb");
  });

  it("leaves a clean value untouched", () => {
    expect(readEnvTrimmed("https://elxea.com", "fb")).toBe("https://elxea.com");
  });
});

/**
 * Credentials hit the same defect, and hide it better: a Channel Secret with a
 * trailing newline is 32 correct characters plus one invisible one, and the
 * only symptom is the provider's generic rejection. That is what took the Web
 * LINE linking flow down on 2026-08-22 (`invalid_client` on every token
 * exchange) while email login, reading a clean variable for the same channel,
 * kept working. See `resolveLinkChannelSecret` in `lib/line/link-flow.ts`.
 */
describe("readSecretEnvTrimmed", () => {
  it("strips a trailing newline off a credential", () => {
    expect(readSecretEnvTrimmed(`${"0".repeat(32)}\n`)).toBe("0".repeat(32));
  });

  it("returns undefined rather than a fallback when unset or blank", () => {
    // A credential must never be substituted: an empty or placeholder secret
    // sent upstream turns a config gap into a customer-facing auth error.
    expect(readSecretEnvTrimmed(undefined)).toBeUndefined();
    expect(readSecretEnvTrimmed("")).toBeUndefined();
    expect(readSecretEnvTrimmed("  \t\r\n ")).toBeUndefined();
  });

  it("leaves a clean value untouched", () => {
    expect(readSecretEnvTrimmed("2009473839")).toBe("2009473839");
  });
});

describe("readUrlEnvTrimmed", () => {
  it("removes trailing slashes so callers can always append /path", () => {
    expect(readUrlEnvTrimmed("https://elxea.com/", "fb")).toBe("https://elxea.com");
    expect(readUrlEnvTrimmed("https://elxea.com///", "fb")).toBe("https://elxea.com");
  });

  it("handles the newline and the trailing slash together", () => {
    expect(readUrlEnvTrimmed("https://elxea.com/\n", "fb")).toBe("https://elxea.com");
  });

  it("does not eat the slashes in the scheme", () => {
    expect(readUrlEnvTrimmed("https://", "fb")).toBe("https:");
  });
});

describe("getSiteUrl", () => {
  it("returns a concatenation-safe origin even when the env value is polluted", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", POLLUTED);
    const base = getSiteUrl();
    expect(base).toBe("https://elxea.com");
    expect(`${base}/ja`).toBe("https://elxea.com/ja");
    expect(base).not.toMatch(/\s/);
  });

  it("falls back to the canonical origin when unset", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(getSiteUrl()).toBe(SITE_URL_FALLBACK);
  });

  it("honours an override (preview deployments)", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://preview.example.com");
    expect(getSiteUrl()).toBe("https://preview.example.com");
  });
});

describe("getGtmId", () => {
  it("strips a trailing newline from the container id", () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-ABC1234\n");
    expect(getGtmId()).toBe("GTM-ABC1234");
  });

  it("returns undefined when unset, so nothing is rendered", () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "");
    expect(getGtmId()).toBeUndefined();
  });

  it("drops characters that cannot appear in a container id", () => {
    // The id is interpolated into an inline <script> and into a URL, so it must
    // not be able to carry quotes, angle brackets or whitespace.
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-A'); alert(1); //");
    const id = getGtmId();
    expect(id).toBe("GTM-Aalert1");
    expect(id).not.toMatch(/['"<>\s]/);
  });
});
