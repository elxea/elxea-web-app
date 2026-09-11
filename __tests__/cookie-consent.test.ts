/**
 * Cookie-consent persistence rules.
 *
 * Guards the two defects fixed in fix/cookie-consent-gate:
 *  (A) the banner reappearing for a visitor who already chose, and
 *  (B) Google Tag Manager loading regardless of that choice.
 *
 * The browser-facing half is covered end-to-end in e2e/cookie-consent.spec.ts;
 * this file pins the rules that must hold without a DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  CONSENT_STORAGE_KEY,
  buildConsentCookie,
  consentCookieDomain,
  isAnalyticsAllowed,
  normalizeConsentValue,
  persistConsent,
  readConsentCookie,
  readStoredConsent,
  resetConsentMemoryForTests,
} from "@/lib/consent";

describe("normalizeConsentValue", () => {
  it("reads back the two values this site has ever written", () => {
    // Both keys were written by the pre-fix banner and must keep working, or
    // every existing visitor would be asked again after deploy.
    expect(normalizeConsentValue("all")).toBe("all");
    expect(normalizeConsentValue("essential")).toBe("essential");
  });

  it("accepts legacy and alternative spellings", () => {
    for (const raw of ["accepted", "granted", "true", "YES", " 1 "]) {
      expect(normalizeConsentValue(raw)).toBe("all");
    }
    for (const raw of ["necessary", "declined", "denied", "false", "0"]) {
      expect(normalizeConsentValue(raw)).toBe("essential");
    }
  });

  it("treats absent or unrecognised values as no choice on record", () => {
    // Never guess in the permissive direction: an unreadable value must
    // re-ask, not silently enable tracking.
    for (const raw of [null, undefined, "", "   ", "maybe", "{}"]) {
      expect(normalizeConsentValue(raw)).toBeNull();
    }
  });
});

describe("isAnalyticsAllowed", () => {
  it("allows analytics only for an explicit accept", () => {
    expect(isAnalyticsAllowed("all")).toBe(true);
  });

  it("blocks analytics when declined or not yet chosen", () => {
    expect(isAnalyticsAllowed("essential")).toBe(false);
    expect(isAnalyticsAllowed(null)).toBe(false);
    expect(isAnalyticsAllowed(undefined)).toBe(false);
  });
});

describe("readConsentCookie", () => {
  it("finds the value among other cookies", () => {
    expect(
      readConsentCookie(`foo=1; ${CONSENT_COOKIE_NAME}=all; site_auth=abc`),
    ).toBe("all");
  });

  it("does not match a cookie whose name merely ends with ours", () => {
    expect(readConsentCookie(`not_${CONSENT_COOKIE_NAME}=all`)).toBeNull();
  });

  it("returns null for an empty or absent cookie header", () => {
    expect(readConsentCookie("")).toBeNull();
    expect(readConsentCookie(null)).toBeNull();
    expect(readConsentCookie("other=1")).toBeNull();
  });
});

describe("consentCookieDomain", () => {
  it("widens www to the apex so both hosts share one choice", () => {
    // elxea.com and www.elxea.com both serve the site and neither redirects to
    // the other, so a localStorage-only choice is invisible across them.
    expect(consentCookieDomain("www.elxea.com")).toBe("elxea.com");
    expect(consentCookieDomain("elxea.com")).toBe("elxea.com");
  });

  it("keeps any other host to itself", () => {
    expect(consentCookieDomain("elxea-web-app-abc123.vercel.app")).toBe(
      "elxea-web-app-abc123.vercel.app",
    );
  });

  it("sends no domain attribute for hosts that cannot carry one", () => {
    expect(consentCookieDomain("localhost")).toBeNull();
    expect(consentCookieDomain("127.0.0.1")).toBeNull();
    expect(consentCookieDomain("[::1]")).toBeNull();
    expect(consentCookieDomain("")).toBeNull();
  });
});

describe("buildConsentCookie", () => {
  it("scopes the cookie to the whole site with a long max-age", () => {
    const cookie = buildConsentCookie("all", { hostname: "www.elxea.com", secure: true });
    expect(cookie).toContain(`${CONSENT_COOKIE_NAME}=all`);
    expect(cookie).toContain("path=/");
    expect(cookie).toContain(`max-age=${CONSENT_COOKIE_MAX_AGE_SECONDS}`);
    expect(cookie).toContain("samesite=lax");
    expect(cookie).toContain("domain=elxea.com");
    expect(cookie).toContain("secure");
  });

  it("omits secure and domain on plain-http localhost", () => {
    const cookie = buildConsentCookie("essential", { hostname: "localhost" });
    expect(cookie).toContain(`${CONSENT_COOKIE_NAME}=essential`);
    expect(cookie).not.toContain("domain=");
    expect(cookie).not.toContain("secure");
  });
});

// --- browser-backed helpers -------------------------------------------------

type FakeWindow = {
  localStorage: Storage;
  location: { hostname: string; protocol: string };
};

function installBrowser(options: {
  localStorage?: Partial<Storage>;
  cookie?: string;
  hostname?: string;
  protocol?: string;
} = {}) {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
    ...options.localStorage,
  } as Storage;

  const fakeWindow: FakeWindow = {
    localStorage,
    location: {
      hostname: options.hostname ?? "www.elxea.com",
      protocol: options.protocol ?? "https:",
    },
  };

  let cookie = options.cookie ?? "";
  const fakeDocument = {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value;
    },
  };

  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  return { store, getCookie: () => cookie };
}

beforeEach(() => {
  resetConsentMemoryForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetConsentMemoryForTests();
});

describe("readStoredConsent", () => {
  it("returns null when nothing has been chosen", () => {
    installBrowser();
    expect(readStoredConsent()).toBeNull();
  });

  it("reads a choice written by the pre-fix banner", () => {
    const { store } = installBrowser();
    store.set(CONSENT_STORAGE_KEY, "all");
    expect(readStoredConsent()).toBe("all");
  });

  it("falls back to the cookie when localStorage is empty for this origin", () => {
    // The apex/www split: the choice was made on the other host, so only the
    // domain-scoped cookie carries it.
    installBrowser({ cookie: `${CONSENT_COOKIE_NAME}=essential` });
    expect(readStoredConsent()).toBe("essential");
  });

  it("survives localStorage throwing instead of taking the page down", () => {
    // Safari with cookies blocked, and some in-app browsers (this site is
    // opened inside the LINE in-app browser for LIFF linking), throw on access.
    installBrowser({
      localStorage: {
        getItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      },
      cookie: `${CONSENT_COOKIE_NAME}=all`,
    });
    expect(readStoredConsent()).toBe("all");
  });

  it("returns null on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(readStoredConsent()).toBeNull();
  });
});

describe("persistConsent", () => {
  it("writes both stores so the choice survives an origin change", () => {
    const { store, getCookie } = installBrowser();
    persistConsent("all");
    expect(store.get(CONSENT_STORAGE_KEY)).toBe("all");
    expect(getCookie()).toContain(`${CONSENT_COOKIE_NAME}=all`);
    expect(getCookie()).toContain("domain=elxea.com");
    expect(readStoredConsent()).toBe("all");
  });

  it("keeps the choice for the session when every store is blocked", () => {
    installBrowser({
      localStorage: {
        getItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
        setItem: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      },
    });
    // No cookie either: the fake document keeps whatever is assigned, so assert
    // via the read path with the cookie deliberately unreadable.
    vi.stubGlobal("document", {
      get cookie(): string {
        throw new DOMException("blocked", "SecurityError");
      },
      set cookie(_value: string) {
        throw new DOMException("blocked", "SecurityError");
      },
    });

    expect(() => persistConsent("essential")).not.toThrow();
    // Not persisted anywhere, but the banner must not come back mid-visit.
    expect(readStoredConsent()).toBe("essential");
  });
});
