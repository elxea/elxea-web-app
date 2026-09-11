/**
 * The dataLayer gate in `lib/analytics.ts`.
 *
 * Blocking Google Tag Manager is not enough on its own: the tracking helpers
 * push into `window.dataLayer` whether or not the container is loaded, and GTM
 * replays the entire existing dataLayer when it boots. Without this gate, a
 * visitor who browsed under "必要なもののみ" and later accepted would have that
 * earlier browsing sent retroactively.
 *
 * This lives in a unit test rather than in e2e/cookie-consent.spec.ts because
 * firing a real `view_item` needs a product detail page, and CI runs the e2e
 * suite without Shopify credentials — the product listing is empty there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { CONSENT_STORAGE_KEY, resetConsentMemoryForTests } from "@/lib/consent";

type DataLayerWindow = { dataLayer?: Record<string, unknown>[] };

function installBrowser(storedChoice: string | null) {
  const store = new Map<string, string>();
  if (storedChoice !== null) store.set(CONSENT_STORAGE_KEY, storedChoice);

  const fakeWindow: DataLayerWindow & { localStorage: Storage } = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      get length() {
        return store.size;
      },
    } as Storage,
  };

  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", { cookie: "" });
  return fakeWindow;
}

/** Fresh module instance so the consent read is not cached across cases. */
async function loadAnalytics() {
  vi.resetModules();
  return import("@/lib/analytics");
}

beforeEach(() => {
  resetConsentMemoryForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  resetConsentMemoryForTests();
});

describe("dataLayer pushes respect the cookie choice", () => {
  it("queues nothing before a choice is made", async () => {
    const win = installBrowser(null);
    const { trackSearch, trackViewItem } = await loadAnalytics();

    trackSearch("煎茶");
    trackViewItem({ id: "1", name: "煎茶", price: 1000, currency: "JPY" });

    expect(win.dataLayer ?? []).toEqual([]);
  });

  it("queues nothing after 必要なもののみ", async () => {
    const win = installBrowser("essential");
    const { trackSearch, trackAddToCart } = await loadAnalytics();

    trackSearch("煎茶");
    trackAddToCart({
      id: "1",
      name: "煎茶",
      price: 1000,
      currency: "JPY",
      quantity: 1,
    });

    expect(win.dataLayer ?? []).toEqual([]);
  });

  it("pushes after 同意する", async () => {
    // Positive control: without this, "nothing was pushed" above could just
    // mean the helpers never push at all.
    const win = installBrowser("all");
    const { trackSearch } = await loadAnalytics();

    trackSearch("煎茶");

    expect(win.dataLayer).toEqual([{ event: "search", search_term: "煎茶" }]);
  });

  it("starts pushing as soon as the choice flips to all", async () => {
    const win = installBrowser("essential");
    const { trackSearch } = await loadAnalytics();

    trackSearch("before");
    expect(win.dataLayer ?? []).toEqual([]);

    (window as unknown as { localStorage: Storage }).localStorage.setItem(
      CONSENT_STORAGE_KEY,
      "all",
    );
    trackSearch("after");

    expect(win.dataLayer).toHaveLength(1);
    expect(win.dataLayer?.[0]).toMatchObject({ search_term: "after" });
  });
});
