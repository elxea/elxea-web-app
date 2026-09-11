/**
 * T6 — the two `prompt` decisions, pinned together in one file on purpose.
 *
 * They point in opposite directions and are easy to confuse:
 *
 *  - LINE must NOT send `prompt`. `prompt=consent` forces the consent screen
 *    even when the user has already granted every scope, so returning users were
 *    re-consenting on every login. The code comment justified it as needed "for a
 *    fresh token exchange", which is not true — the exchange rests on
 *    `code` + `state` + `code_verifier`.
 *  - Shopify MUST send `prompt=login`. Without it the Shopify SSO cookie silently
 *    re-authenticates the previous user, so a shared device cannot switch
 *    accounts. It is also the backstop for the one residual risk in the logout
 *    fix: if our `shop_it` cannot be decrypted we skip Shopify's RP-initiated
 *    logout, leaving Shopify's SSO cookie in place — and `prompt=login` forces
 *    re-authentication anyway.
 *
 * Asserting them in the same file is the point: someone deleting the LINE
 * `prompt` must see, in the same breath, that the Shopify one is load-bearing.
 *
 * The same file now also pins LINE's auto login, because that is the reason the
 * LINE `prompt` omission matters at all. Auto login is the only path by which a
 * phone opens the LINE app instead of the access.line.me email/QR screen; it is
 * on by default, no parameter can force it, and exactly two things switch it
 * off — `prompt=login` and `disable_auto_login=true`. So "send no prompt" and
 * "send no disable_auto_login" are one decision under two names, and they belong
 * in one file. Sources are collected in lib/line/auto-login.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  AUTO_LOGIN_FAILED_PARAM,
  AUTO_LOGIN_FAILED_VALUE,
  autoLoginFailedInSearch,
  wantsAutoLoginDisabled,
} from "@/lib/line/auto-login";

const cookieStore = {
  get: vi.fn(() => undefined),
  set: vi.fn(),
  delete: vi.fn(),
  has: vi.fn(() => false),
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

const SAVED = {
  AUTH_LINE_ID: process.env.AUTH_LINE_ID,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  LINE_ALLOWED_CALLBACK_HOSTS: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_LINE_ID = "test-channel-id";
  process.env.NEXTAUTH_URL = "https://www.elxea.com";
  delete process.env.LINE_ALLOWED_CALLBACK_HOSTS;
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function request(url: string) {
  return new NextRequest(url, { headers: { host: "www.elxea.com" } });
}

describe("LINE authorize URL carries no prompt", () => {
  it("POST /api/line-login/init", async () => {
    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(request("https://www.elxea.com/api/line-login/init"));
    const { authUrl } = (await res.json()) as { authUrl: string };

    const url = new URL(authUrl);
    expect(url.host).toBe("access.line.me");
    expect(url.searchParams.has("prompt")).toBe(false);
    // The parameters that DO carry the flow must still be there.
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBeTruthy();
    /* email は既定で載せない（M-0 / fail-soft）。新チャネル 2011239425 は
       メールアドレス取得権限が未承認で、投げると認可ごと拒まれる。
       判断は lib/line/login-channel.ts、単体は line-channel-namespace.test.ts。 */
    expect(url.searchParams.get("scope")).toBe("profile openid");
  });

  it("GET /api/line-login (legacy redirect route)", async () => {
    const { GET } = await import("@/app/api/line-login/route");
    const res = await GET(request("https://www.elxea.com/api/line-login"));

    const url = new URL(res.headers.get("location")!);
    expect(url.host).toBe("access.line.me");
    expect(url.searchParams.has("prompt")).toBe(false);
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});

/**
 * `bot_prompt` は `prompt` とは別物である（M-0 / 2026-08-25 に復活）。
 *
 * このファイルが長々と説いているのは「LINE には `prompt` を送るな」という決定で、
 * 理由は auto login が切れて LINE アプリに渡らなくなるから。`bot_prompt` は
 * **友だち追加の出し方**を指定する別のパラメータで、auto login には影響しない。
 * 名前が似ているせいで、片方を消すついでにもう片方も消される事故が起きやすい —
 * だから同じファイルで、両方の性質を並べて固定する。
 *
 * 2026-04-13 に `bot_prompt` を外したのは、本番 OA `@307tzhkw` が別プロバイダに
 * あってこの Login チャネルに紐付けられなかったから。新チャネル 2011239425 は
 * 紐付け済みなので前提ごと解消した。友だち追加は親切ではなく、**Account Link
 * （LINE トーク内からの連携）と配信が届く条件**そのものである。
 */
describe("LINE authorize URL carries bot_prompt (a different parameter from prompt)", () => {
  it("POST /api/line-login/init sends bot_prompt=aggressive but still no prompt", async () => {
    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(request("https://www.elxea.com/api/line-login/init"));
    const { authUrl } = (await res.json()) as { authUrl: string };

    const url = new URL(authUrl);
    expect(url.searchParams.get("bot_prompt")).toBe("aggressive");
    expect(url.searchParams.has("prompt")).toBe(false);
    // ...and it must not have re-enabled the thing that breaks the app hand-off.
    expect(url.searchParams.has("disable_auto_login")).toBe(false);
  });

  it("GET /api/line-login sends bot_prompt=aggressive but still no prompt", async () => {
    const { GET } = await import("@/app/api/line-login/route");
    const res = await GET(request("https://www.elxea.com/api/line-login"));

    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("bot_prompt")).toBe("aggressive");
    expect(url.searchParams.has("prompt")).toBe(false);
    expect(url.searchParams.has("disable_auto_login")).toBe(false);
  });

  it("LINE_LOGIN_BOT_PROMPT=off drops the parameter entirely (no redeploy needed)", async () => {
    process.env.LINE_LOGIN_BOT_PROMPT = "off";
    try {
      const { POST } = await import("@/app/api/line-login/init/route");
      const res = await POST(request("https://www.elxea.com/api/line-login/init"));
      const { authUrl } = (await res.json()) as { authUrl: string };
      expect(new URL(authUrl).searchParams.has("bot_prompt")).toBe(false);
    } finally {
      delete process.env.LINE_LOGIN_BOT_PROMPT;
    }
  });
});

describe("LINE auto login is left enabled on the normal path", () => {
  /* The observed bug (iOS Safari, 2026-08-20) was landing on the
   * access.line.me email/QR screen instead of the LINE app. Either parameter
   * below reproduces that landing on every device, so their absence is the
   * feature, not an oversight. */
  it("POST /api/line-login/init sends nothing that disables auto login", async () => {
    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(request("https://www.elxea.com/api/line-login/init"));
    const { authUrl } = (await res.json()) as { authUrl: string };

    const url = new URL(authUrl);
    expect(url.searchParams.has("disable_auto_login")).toBe(false);
    expect(url.searchParams.has("disable_ios_auto_login")).toBe(false);
  });

  it("GET /api/line-login sends nothing that disables auto login", async () => {
    const { GET } = await import("@/app/api/line-login/route");
    const res = await GET(request("https://www.elxea.com/api/line-login"));

    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.has("disable_auto_login")).toBe(false);
    expect(url.searchParams.has("disable_ios_auto_login")).toBe(false);
  });
});

describe("auto login is disabled only on an explicit retry", () => {
  it("POST /api/line-login/init?disable_auto_login=1", async () => {
    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(
      request("https://www.elxea.com/api/line-login/init?disable_auto_login=1"),
    );
    const { authUrl } = (await res.json()) as { authUrl: string };

    const url = new URL(authUrl);
    expect(url.searchParams.get("disable_auto_login")).toBe("true");
    // The retry must still be a complete, valid authorization request.
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBeTruthy();
    /* email は既定で載せない（M-0 / fail-soft）。新チャネル 2011239425 は
       メールアドレス取得権限が未承認で、投げると認可ごと拒まれる。
       判断は lib/line/login-channel.ts、単体は line-channel-namespace.test.ts。 */
    expect(url.searchParams.get("scope")).toBe("profile openid");
  });

  it("GET /api/line-login?disable_auto_login=true", async () => {
    const { GET } = await import("@/app/api/line-login/route");
    const res = await GET(
      request("https://www.elxea.com/api/line-login?disable_auto_login=true"),
    );

    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("disable_auto_login")).toBe("true");
  });

  it("treats anything but an explicit opt-in as 'keep auto login'", () => {
    for (const raw of ["0", "false", "yes", "", "TRUE"]) {
      const req = request(
        `https://www.elxea.com/api/line-login?disable_auto_login=${encodeURIComponent(raw)}`,
      );
      expect(wantsAutoLoginDisabled(req)).toBe(false);
    }
    expect(
      wantsAutoLoginDisabled(request("https://www.elxea.com/api/line-login")),
    ).toBe(false);
  });
});

describe("the failed-auto-login round trip is wired end to end", () => {
  it("a state mismatch still fails closed, and carries the retry hint", async () => {
    /* No `line_oauth_state` cookie → mismatch. LINE documents that this is
     * indistinguishable from CSRF, so the hint must never relax the check. */
    cookieStore.get.mockReturnValue(undefined);

    const { GET } = await import("@/app/api/line-callback/route");
    const res = await GET(
      request("https://www.elxea.com/api/line-callback?code=abc&state=whatever"),
    );

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/ja/login");
    expect(location.searchParams.get("error")).toBe("StateMismatch");
    expect(location.searchParams.get(AUTO_LOGIN_FAILED_PARAM)).toBe(
      AUTO_LOGIN_FAILED_VALUE,
    );
  });

  it("the login screen reads the flag the callback writes", () => {
    /* Pins the two halves together: rename the parameter on one side only and
     * the retry silently stops happening, leaving the user looping on the
     * email screen with no visible error. */
    const written = new URL("https://www.elxea.com/ja/login?error=StateMismatch");
    written.searchParams.set(AUTO_LOGIN_FAILED_PARAM, AUTO_LOGIN_FAILED_VALUE);

    expect(autoLoginFailedInSearch(written.search)).toBe(true);
    expect(autoLoginFailedInSearch("?error=StateMismatch")).toBe(false);
    expect(autoLoginFailedInSearch("")).toBe(false);
  });
});

describe("Shopify authorize URL keeps prompt=login", () => {
  it("GET /api/auth/login", async () => {
    const { GET } = await import("@/app/api/auth/login/route");
    const res = await GET(request("https://www.elxea.com/api/auth/login?locale=ja"));

    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("both state cookies are issued through the same scope rule", () => {
  /* Look cookies up BY NAME rather than by position. Both routes now set two
   * flow cookies (`line_oauth_state` and `line_oauth_nonce`), so "the last call"
   * silently became a different cookie the moment the nonce was added. */
  const callFor = (name: string) =>
    cookieStore.set.mock.calls.find((call: unknown[]) => call[0] === name);

  const optionsOf = (call: unknown[] | undefined) => {
    const opts = (call?.[2] ?? {}) as Record<string, unknown>;
    return { domain: opts.domain, path: opts.path, secure: opts.secure, httpOnly: opts.httpOnly };
  };

  it("init and the legacy route agree on the line_oauth_state scope", async () => {
    const { POST } = await import("@/app/api/line-login/init/route");
    await POST(request("https://www.elxea.com/api/line-login/init"));
    const fromInit = callFor("line_oauth_state");

    cookieStore.set.mockClear();

    const { GET } = await import("@/app/api/line-login/route");
    await GET(request("https://www.elxea.com/api/line-login"));
    const fromLegacy = callFor("line_oauth_state");

    /* These two routes used to disagree: init scoped the state cookie to the
     * apex while the legacy route set it host-only, so a state issued by one
     * was invisible to a callback that expected the other. Compare the options,
     * not the random state value. */
    expect(fromInit?.[0]).toBe("line_oauth_state");
    expect(fromLegacy?.[0]).toBe("line_oauth_state");
    expect(optionsOf(fromLegacy)).toEqual(optionsOf(fromInit));
    expect(optionsOf(fromInit).domain).toBe(".elxea.com");
  });

  it("issues the nonce cookie at the same scope as the state cookie (D11)", async () => {
    /* The callback fails closed without a nonce cookie, so if the two cookies
     * were scoped differently, a round trip that crossed apex/www would lose the
     * nonce while keeping the state — and every such login would break. Same
     * class of bug the state cookie already had; pinned so it cannot recur on the
     * new cookie. */
    for (const [label, run] of [
      [
        "init",
        async () => {
          const { POST } = await import("@/app/api/line-login/init/route");
          await POST(request("https://www.elxea.com/api/line-login/init"));
        },
      ],
      [
        "legacy",
        async () => {
          const { GET } = await import("@/app/api/line-login/route");
          await GET(request("https://www.elxea.com/api/line-login"));
        },
      ],
    ] as const) {
      cookieStore.set.mockClear();
      await run();

      const state = callFor("line_oauth_state");
      const nonce = callFor("line_oauth_nonce");

      expect(nonce, `${label} must issue a nonce cookie`).toBeDefined();
      expect(optionsOf(nonce)).toEqual(optionsOf(state));
      // Distinct random values: sharing one would expose the nonce through the URL.
      expect(nonce?.[1]).not.toBe(state?.[1]);
    }
  });

  it("puts a nonce on the authorize URL, separate from state", async () => {
    const { POST } = await import("@/app/api/line-login/init/route");
    const response = await POST(request("https://www.elxea.com/api/line-login/init"));
    const { authUrl } = (await response.json()) as { authUrl: string };

    const url = new URL(authUrl);
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("nonce")).not.toBe(url.searchParams.get("state"));
  });
});

describe("an untrusted host is refused rather than sent to production (symptom 3)", () => {
  /* `NEXTAUTH_URL` is unset in preview while Vercel injects
   * `VERCEL_PROJECT_PRODUCTION_URL` into every environment, so `getBaseUrl()`
   * resolved to the PRODUCTION origin on a preview deployment and the LINE round
   * trip delivered the user to the production top page. Refusing is the correct
   * outcome; silently switching deployments is not. */
  it.each([
    "preview-abc.vercel.app",
    "elxea-web-app-git-feat-x.vercel.app",
    "evil.example",
    "evil-elxea.com",
  ])("POST /api/line-login/init on %s returns 503", async (host) => {
    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(
      new NextRequest("https://internal.example/api/line-login/init", { headers: { host } }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("auth_host_not_registered");
  });

  it.each(["www.elxea.com", "elxea.com", "WWW.ELXEA.COM:443"])(
    "still serves our own host %s",
    async (host) => {
      const { POST } = await import("@/app/api/line-login/init/route");
      const res = await POST(
        new NextRequest("https://www.elxea.com/api/line-login/init", { headers: { host } }),
      );
      expect(res.status).toBe(200);
      expect(new URL((await res.json()).authUrl).host).toBe("access.line.me");
    },
  );

  it("GET /api/auth/login on an untrusted host returns 503", async () => {
    const { GET } = await import("@/app/api/auth/login/route");
    const res = await GET(
      new NextRequest("https://internal.example/api/auth/login?locale=ja", {
        headers: { host: "preview-abc.vercel.app" },
      }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("auth_host_not_registered");
  });
});

describe("unconfigured LINE channel fails closed with 503", () => {
  it("returns 503 auth_not_configured rather than 500", async () => {
    delete process.env.AUTH_LINE_ID;
    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(request("https://www.elxea.com/api/line-login/init"));

    /* 503, not 500: the channel is not misbehaving, it is not configured for this
     * deployment. The login button reads this to stay disabled with a specific
     * reason instead of offering a control that cannot work. */
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "auth_not_configured" });
  });
});
