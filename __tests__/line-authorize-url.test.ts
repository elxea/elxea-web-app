/**
 * 認可 URL の方針を**全経路まとめて**固定する検査。
 *
 * ## なぜこのファイルが要るのか
 *
 * 2026-03-25、`app/api/line-login/route.ts` に `prompt: "consent"` が入った。
 * 動機は「デスクトップで前回ログイン済みのプロフィールが自動表示される」という
 * **PC の話**で、モバイルの確認はされなかった。`prompt=login` / `prompt=consent`
 * は LINE の自動ログインを殺すので、その日からスマホは LINE アプリへ渡らなくなった。
 *
 * 除去されたのは **146 日後**の 2026-08-18（`ab25915`）である。その間に、
 *
 *   - 「`prompt` を設定するとブラウザ経路に落ちる」と書いてあったコメントが、
 *     *別の* コミット（`b8f18c8`「for LINE app direct launch」）で消されていた
 *   - 2026-04-13 の `151d85b` は、`prompt: "consent"` を含む
 *     `URLSearchParams` を編集しながら、その行を残して通り過ぎた
 *   - 2026-04-11 の調査タスクは「実装側のベストプラクティスは既に入っている」と
 *     結論し、原因を LINE コンソール側の外部ブロッカーに帰して archive された
 *     （その時点でそのファイルには `prompt: "consent"` があった）
 *
 * 共通しているのは「**人がパラメータの一覧を最後まで読まなかった**」ことである。
 * だから人に読ませるのをやめ、機械に読ませる。`__tests__/authorize-url-prompt.test.ts`
 * が `prompt` 単体を見るのに対し、こちらは **自動ログインを殺す 3 パラメータ全部**を、
 * **全経路**について、リストを回して検査する。新しい導線が増えたら
 * `AUTHORIZE_URL_ROUTES` に足すこと。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import {
  AUTO_LOGIN_KILLING_PARAMS,
  buildLineAuthorizeUrl,
  lineUiLocales,
} from "@/lib/line/authorize-url";

const cookieStore = {
  get: vi.fn(() => undefined),
  set: vi.fn(),
  delete: vi.fn(),
  has: vi.fn(() => false),
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

/* 連携経路は Shopify セッションと台帳照会を通るので、そこだけ差し替える。
   検査したいのは「どんなパラメータを組み立てるか」だけである。 */
vi.mock("@/lib/firebase/auth-guard", () => ({
  requireAuth: vi.fn(async () => ({
    authenticated: true,
    customerId: "cust_1",
    email: "x@example.com",
  })),
}));
vi.mock("@/lib/ratelimit", () => ({
  enforceRateLimit: vi.fn(async () => null),
  limiters: new Proxy({}, { get: () => ({}) }),
}));
vi.mock("@/lib/line/linkage-status", () => ({
  fetchLineLinkageStatus: vi.fn(async () => ({ linked: false })),
}));

const SAVED = {
  AUTH_LINE_ID: process.env.AUTH_LINE_ID,
  LINE_LIFF_CHANNEL_ID: process.env.LINE_LIFF_CHANNEL_ID,
  LINE_LIFF_CHANNEL_SECRET: process.env.LINE_LIFF_CHANNEL_SECRET,
  LINE_LINK_STATE_SECRET: process.env.LINE_LINK_STATE_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  LINE_ALLOWED_CALLBACK_HOSTS: process.env.LINE_ALLOWED_CALLBACK_HOSTS,
  LINE_LOGIN_BOT_PROMPT: process.env.LINE_LOGIN_BOT_PROMPT,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_LINE_ID = "2011239425";
  process.env.LINE_LIFF_CHANNEL_ID = "2011239425";
  process.env.LINE_LIFF_CHANNEL_SECRET = "test-link-secret";
  process.env.LINE_LINK_STATE_SECRET = "test-link-state-secret-0123456789";
  process.env.NEXTAUTH_URL = "https://elxea.com";
  delete process.env.LINE_ALLOWED_CALLBACK_HOSTS;
  delete process.env.LINE_LOGIN_BOT_PROMPT;
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function request(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    headers: { host: "elxea.com", ...headers },
  });
}

/**
 * 認可 URL を作る**すべての経路**。
 *
 * 増やしたら必ずここに足すこと。足さないと、この検査は増えた経路を見ない。
 */
const AUTHORIZE_URL_ROUTES: Array<{
  name: string;
  run: () => Promise<string>;
}> = [
  {
    name: "POST /api/line-login/init （/login のボタンが読む本命経路）",
    run: async () => {
      const { POST } = await import("@/app/api/line-login/init/route");
      const res = await POST(request("https://elxea.com/api/line-login/init"));
      return ((await res.json()) as { authUrl: string }).authUrl;
    },
  },
  {
    name: "GET /api/line-login （旧経路・302・後方互換）",
    run: async () => {
      const { GET } = await import("@/app/api/line-login/route");
      const res = await GET(request("https://elxea.com/api/line-login"));
      return res.headers.get("location")!;
    },
  },
  {
    name: "POST /api/user/line-link/init （マイページの連携）",
    run: async () => {
      const { POST } = await import("@/app/api/user/line-link/init/route");
      const res = await POST(request("https://elxea.com/api/user/line-link/init"));
      return ((await res.json()) as { authUrl: string }).authUrl;
    },
  },
];

describe("認可 URL は全経路で自動ログインを殺さない", () => {
  for (const route of AUTHORIZE_URL_ROUTES) {
    describe(route.name, () => {
      it("自動ログインを無効化するパラメータを 1 つも送らない", async () => {
        const url = new URL(await route.run());
        for (const param of AUTO_LOGIN_KILLING_PARAMS) {
          expect(
            url.searchParams.has(param),
            `${param} が付いている。これは LINE の自動ログインを無効化し、` +
              `スマホで LINE アプリが開かなくなる（2026-03-25〜08-18 の再発と同じ壊し方）。`,
          ).toBe(false);
        }
      });

      it("本物の認可エンドポイントを指す", async () => {
        const url = new URL(await route.run());
        expect(url.host).toBe("access.line.me");
        expect(url.pathname).toBe("/oauth2/v2.1/authorize");
      });

      it("OAuth / OIDC に必要な値は揃っている", async () => {
        const url = new URL(await route.run());
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("client_id")).toBe("2011239425");
        expect(url.searchParams.get("state")).toBeTruthy();
        expect(url.searchParams.get("nonce")).toBeTruthy();
        expect(url.searchParams.get("scope")).toContain("openid");
        expect(url.searchParams.get("redirect_uri")).toMatch(/^https:\/\/elxea\.com\//);
      });

      it("state と nonce は別の値である", async () => {
        const url = new URL(await route.run());
        expect(url.searchParams.get("state")).not.toBe(url.searchParams.get("nonce"));
      });
    });
  }
});

describe("buildLineAuthorizeUrl（方針の本体）", () => {
  const base = {
    channelId: "2011239425",
    redirectUri: "https://elxea.com/api/line-callback",
    state: "s",
    nonce: "n",
    scope: "profile openid",
  };

  it("既定では自動ログインを殺すパラメータを一切載せない", () => {
    const url = new URL(buildLineAuthorizeUrl(base));
    for (const p of AUTO_LOGIN_KILLING_PARAMS) {
      expect(url.searchParams.has(p)).toBe(false);
    }
  });

  it("disableAutoLogin を明示したときだけ disable_auto_login=true を載せる", () => {
    const off = new URL(buildLineAuthorizeUrl(base));
    expect(off.searchParams.has("disable_auto_login")).toBe(false);

    const on = new URL(buildLineAuthorizeUrl({ ...base, disableAutoLogin: true }));
    expect(on.searchParams.get("disable_auto_login")).toBe("true");
  });

  it("disable_ios_auto_login は入力にも存在せず、載せる手段が無い", () => {
    /* これは「うっかり付けない」ではなく「付けられない」ことの確認である。
     * 2026-08-30 の調査で、ある検証者がこのパラメータの意味を**逆に読み**、
     * 「付いていないのが原因」と報告した。実際には付けた瞬間に iOS の
     * アプリ受け渡しが恒久的に死ぬ（公式:「If set to true, auto login will be
     * disabled in iOS」）。入力に口が無ければ、その誤読は実装に届かない。 */
    const url = new URL(
      buildLineAuthorizeUrl({
        ...base,
        // @ts-expect-error 入力型に存在しないことをテストで固定する
        disable_ios_auto_login: true,
      }),
    );
    expect(url.searchParams.has("disable_ios_auto_login")).toBe(false);
  });

  it("bot_prompt は prompt とは別物で、指定したときだけ載る", () => {
    expect(
      new URL(buildLineAuthorizeUrl(base)).searchParams.has("bot_prompt"),
    ).toBe(false);
    const url = new URL(buildLineAuthorizeUrl({ ...base, botPrompt: "aggressive" }));
    expect(url.searchParams.get("bot_prompt")).toBe("aggressive");
    expect(url.searchParams.has("prompt")).toBe(false);
  });

  it("ui_locales を渡すと載る（LINE 画面が英語になるのを防ぐ）", () => {
    const url = new URL(buildLineAuthorizeUrl({ ...base, uiLocales: "ja" }));
    expect(url.searchParams.get("ui_locales")).toBe("ja");
  });
});

describe("lineUiLocales", () => {
  it("NEXT_LOCALE=en なら en", () => {
    const req = request("https://elxea.com/api/line-login/init", {
      cookie: "NEXT_LOCALE=en",
    });
    expect(lineUiLocales(req)).toBe("en");
  });

  it("cookie が無ければ ja に倒す", () => {
    expect(lineUiLocales(request("https://elxea.com/api/line-login/init"))).toBe("ja");
  });
});
