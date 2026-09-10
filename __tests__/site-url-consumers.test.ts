import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * End-to-end guard for the consumers of `NEXT_PUBLIC_SITE_URL`.
 *
 * `__tests__/env-trimmed.test.ts` proves the helper trims. This file proves the
 * things a customer actually sees — the sitemap Google crawls and the links in
 * the transactional emails — come out clean when the env var carries the
 * trailing newline that shipped to production.
 * See deliverables/ga4-searchconsole-repair.md §2 (A).
 *
 * No mail is sent: the `resend` SDK is mocked and the rendered payload is
 * captured in-process.
 */

// The polluted value exactly as it was stored on Vercel.
const POLLUTED_SITE_URL = "https://elxea.com\n";

const sent: { subject?: string; text?: string; html?: string }[] = [];

vi.mock("resend", () => {
  class Resend {
    emails = {
      send: async (payload: { subject?: string; text?: string; html?: string }) => {
        sent.push(payload);
        return { data: { id: "test" }, error: null };
      },
    };
  }
  return { Resend };
});

/** Every absolute elxea URL that appears in a string. */
function extractUrls(body: string): string[] {
  return body.match(/https?:\/\/[^\s"'<>)]*/g) ?? [];
}

beforeEach(() => {
  sent.length = 0;
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", POLLUTED_SITE_URL);
  vi.stubEnv("RESEND_API_KEY", "test-key-not-used");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * `app/sitemap.ts` reaches Shopify and Sanity over the network for its dynamic
 * entries (both branches are try/caught, so the assertions below hold either
 * way — but the call still waits on a real round trip). Under Vitest's default
 * 5s budget that made this block fail intermittently whenever the `storybook`
 * project's Chromium was booting on the same machine: the whole cost was cold
 * connection setup, not anything the sitemap does.
 *
 * The budget is widened rather than any assertion being weakened — every
 * expectation is unchanged. The real fix is to stub the two fetches so this
 * stops depending on wall-clock latency at all; that is a change to what the
 * test covers, so it is left for its own commit.
 */
const NETWORK_TIMEOUT_MS = 30_000;

describe("app/sitemap.ts", () => {
  it("emits no URL containing whitespace when the env value has a trailing newline", { timeout: NETWORK_TIMEOUT_MS }, async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();

    expect(entries.length).toBeGreaterThan(0);

    const dirty = entries.map((e) => e.url).filter((u) => /\s/.test(u));
    expect(dirty).toEqual([]);
  });

  it("produces parseable absolute URLs on the canonical origin", { timeout: NETWORK_TIMEOUT_MS }, async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();

    for (const entry of entries) {
      expect(() => new URL(entry.url)).not.toThrow();
      expect(new URL(entry.url).origin).toBe("https://elxea.com");
      // No accidental double slash from a trailing slash in the env value.
      expect(entry.url.slice("https://".length)).not.toContain("//");
    }
  });

  it("includes the locale-prefixed home page at the expected exact string", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toContain("https://elxea.com/ja");
  });
});

describe("transactional email templates", () => {
  const cases: {
    name: string;
    run: () => Promise<unknown>;
  }[] = [
    {
      name: "welcome",
      run: async () => {
        const { sendWelcomeEmail } = await import("@/lib/email/welcome");
        return sendWelcomeEmail({
          customerEmail: "test@example.com",
          customerName: "テスト",
          locale: "ja",
        });
      },
    },
    {
      name: "subscription-reminder",
      run: async () => {
        const { sendSubscriptionReminder } = await import(
          "@/lib/email/subscription-reminder"
        );
        return sendSubscriptionReminder({
          customerEmail: "test@example.com",
          customerName: "テスト",
          nextBillingDate: "2026-09-01",
          items: [
            { title: "煎茶", quantity: 1, price: "1000", currencyCode: "JPY" },
          ],
          deliveryInterval: "1ヶ月ごと",
        });
      },
    },
    {
      name: "dunning",
      run: async () => {
        const { sendDunningEmail } = await import("@/lib/email/dunning");
        return sendDunningEmail({
          customerEmail: "test@example.com",
          customerName: "テスト",
          attemptNumber: 1,
          isFinalAttempt: false,
          items: [
            { title: "煎茶", quantity: 1, price: "1000", currencyCode: "JPY" },
          ],
        });
      },
    },
    {
      name: "farmer-notification",
      run: async () => {
        const { sendFarmerNotification } = await import(
          "@/lib/email/farmer-notification"
        );
        return sendFarmerNotification({
          customerEmail: "test@example.com",
          customerName: "テスト",
          farmerName: "生産者",
          farmerSlug: "test-farmer",
          newItems: [
            {
              type: "article",
              slug: "new-article",
              title: "新着記事",
              imageUrl: null,
              // Deliberately built from the same base the template uses, so a
              // regression in the caller (app/api/cron/farmer-notification)
              // would show up here too.
              url: "https://elxea.com/ja/journal/new-article",
              excerpt: null,
            },
          ],
        });
      },
    },
  ];

  for (const { name, run } of cases) {
    it(`${name}: every link is a clean absolute URL`, async () => {
      await run();

      expect(sent).toHaveLength(1);
      const payload = sent[0];
      const bodies = [payload.text ?? "", payload.html ?? ""];
      expect(bodies.join("").length).toBeGreaterThan(0);

      // The literal broken form that reached production: the origin, then
      // whitespace, then the path — "https://elxea.com\n/ja/account".
      // (A bare origin at the end of a text line is fine and expected.)
      for (const body of bodies) {
        expect(body).not.toMatch(/https:\/\/elxea\.com\s+\//);
      }

      const urls = bodies.flatMap(extractUrls);
      const elxeaUrls = urls.filter((u) => u.startsWith("https://elxea.com"));
      expect(elxeaUrls.length).toBeGreaterThan(0);

      for (const url of elxeaUrls) {
        expect(url).not.toMatch(/\s/);
        expect(() => new URL(url)).not.toThrow();
        expect(new URL(url).origin).toBe("https://elxea.com");
      }
    });
  }
});
