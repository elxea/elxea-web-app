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
  lineAppHandoffFromRequest,
  lineUiLocales,
} from "@/lib/line/authorize-url";
import {
  LINE_APP_HANDOFF_BASE_URL_DEFAULT,
  LINE_APP_HANDOFF_PATH,
} from "@/lib/line/endpoints";

/**
 * User-Agent の見本。
 *
 * `ios-safari` / `android-browser` は自動ログインが公式に成立する側なので、
 * **今日どおり認可エンドポイントへ行くこと**を退行検査として固定する。
 */
const UA = {
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.35 Mobile/15E148 Safari/604.1",
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  lineInApp:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.9.0",
} as const;

/** 受け渡し URL の `returnUri` に入っている認可要求を取り出す。 */
function authorizeRequestInside(handoffUrl: URL): URL {
  const returnUri = handoffUrl.searchParams.get("returnUri");
  expect(returnUri, "returnUri が無い。認可要求が失われている。").toBeTruthy();
  return new URL(returnUri!, "https://access.line.me");
}

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
  /** `userAgent` 省略時は UA ヘッダ無し（= 環境判定は `unknown` = 今日の挙動）。 */
  run: (userAgent?: string) => Promise<string>;
}> = [
  {
    name: "POST /api/line-login/init （/login のボタンが読む本命経路）",
    run: async (userAgent) => {
      const { POST } = await import("@/app/api/line-login/init/route");
      const res = await POST(
        request("https://elxea.com/api/line-login/init", ua(userAgent)),
      );
      return ((await res.json()) as { authUrl: string }).authUrl;
    },
  },
  {
    name: "GET /api/line-login （旧経路・302・後方互換）",
    run: async (userAgent) => {
      const { GET } = await import("@/app/api/line-login/route");
      const res = await GET(request("https://elxea.com/api/line-login", ua(userAgent)));
      return res.headers.get("location")!;
    },
  },
  {
    name: "POST /api/user/line-link/init （マイページの連携）",
    run: async (userAgent) => {
      const { POST } = await import("@/app/api/user/line-link/init/route");
      const res = await POST(
        request("https://elxea.com/api/user/line-link/init", ua(userAgent)),
      );
      return ((await res.json()) as { authUrl: string }).authUrl;
    },
  },
];

/** UA ヘッダを足す（未指定なら足さない）。 */
function ua(userAgent?: string): Record<string, string> {
  return userAgent ? { "user-agent": userAgent } : {};
}

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

/**
 * 着地点の切り替え（PR #180 で残っていた穴）。
 *
 * `access.line.me` は OS の association ファイルに載っていないので、そこへの
 * タップは原理的に LINE アプリを開けない（実測 2026-08-30: 同ホストの
 * `apple-app-site-association` は本文 0 バイト）。アプリに結び付いているのは
 * `access-auto.line.me` の `/oauth2/v2.1/login` だけである。
 */
describe("buildLineAuthorizeUrl（LINE アプリへの着地点）", () => {
  const base = {
    channelId: "2011239425",
    redirectUri: "https://elxea.com/api/line-callback",
    state: "s",
    nonce: "n",
    scope: "profile openid",
  };

  it("既定では今日どおり認可エンドポイントを指す（動いている環境を触らない）", () => {
    const url = new URL(buildLineAuthorizeUrl(base));
    expect(url.host).toBe("access.line.me");
    expect(url.pathname).toBe("/oauth2/v2.1/authorize");
  });

  it("appHandoff で association ファイルに載っている host + path へ着地する", () => {
    const url = new URL(buildLineAuthorizeUrl({ ...base, appHandoff: true }));
    expect(url.origin).toBe(LINE_APP_HANDOFF_BASE_URL_DEFAULT);
    expect(url.host).toBe("access-auto.line.me");
    /* パスは association ファイルの `paths` に載っている値そのもの。ここを外れると
       同じホストでも Universal Link にならず、アプリは開かない。 */
    expect(url.pathname).toBe(LINE_APP_HANDOFF_PATH);
    expect(url.pathname).toBe("/oauth2/v2.1/login");
  });

  it("受け渡し URL でも認可要求は 1 バイトも失われない", () => {
    const handoff = new URL(
      buildLineAuthorizeUrl({
        ...base,
        botPrompt: "aggressive",
        uiLocales: "ja",
        appHandoff: true,
      }),
    );
    /* `loginChannelId` が無いと LINE は 400 を返す（2026-08-30 実測）。 */
    expect(handoff.searchParams.get("loginChannelId")).toBe("2011239425");

    const inner = authorizeRequestInside(handoff);
    expect(inner.pathname).toBe("/oauth2/v2.1/authorize");
    expect(inner.searchParams.get("response_type")).toBe("code");
    expect(inner.searchParams.get("client_id")).toBe("2011239425");
    expect(inner.searchParams.get("redirect_uri")).toBe(base.redirectUri);
    expect(inner.searchParams.get("state")).toBe("s");
    expect(inner.searchParams.get("nonce")).toBe("n");
    expect(inner.searchParams.get("scope")).toBe("profile openid");
    expect(inner.searchParams.get("bot_prompt")).toBe("aggressive");
    expect(inner.searchParams.get("ui_locales")).toBe("ja");
  });

  it("受け渡し URL でも自動ログインを殺すパラメータは載らない（外側・内側とも）", () => {
    const handoff = new URL(buildLineAuthorizeUrl({ ...base, appHandoff: true }));
    const inner = authorizeRequestInside(handoff);
    for (const p of AUTO_LOGIN_KILLING_PARAMS) {
      expect(
        handoff.searchParams.has(p),
        `${p} が受け渡し URL の外側に付いている。`,
      ).toBe(false);
      expect(
        inner.searchParams.has(p),
        `${p} が returnUri の中に付いている。検査の外で復活している。`,
      ).toBe(false);
    }
  });

  it("自動ログイン失敗からの再試行では受け渡しへ行かない", () => {
    /* `disableAutoLogin` は「アプリ受け渡しが失敗したので今回は避ける」ための入力。
       そこでアプリ側へ着地させると同じ失敗を踏ませ、無限ループに戻る。 */
    const url = new URL(
      buildLineAuthorizeUrl({ ...base, appHandoff: true, disableAutoLogin: true }),
    );
    expect(url.host).toBe("access.line.me");
    expect(url.pathname).toBe("/oauth2/v2.1/authorize");
    expect(url.searchParams.get("disable_auto_login")).toBe("true");
  });
});

describe("lineAppHandoffFromRequest（どの環境で着地点を変えるか）", () => {
  const cases: Array<[string, string, boolean]> = [
    ["iPhone の Chrome（公式に自動ログイン非対応）", UA.iosChrome, true],
    ["アプリ内ブラウザ（Instagram）", UA.instagram, true],
    ["iOS Safari（公式に対応・今日動いている）", UA.iosSafari, false],
    ["Android の Chrome（公式に対応・今日動いている）", UA.androidChrome, false],
    ["LINE のアプリ内ブラウザ（そもそも LINE の中）", UA.lineInApp, false],
  ];

  for (const [label, userAgent, expected] of cases) {
    it(`${label} → ${expected ? "受け渡しへ" : "今日どおり認可へ"}`, () => {
      expect(
        lineAppHandoffFromRequest(
          request("https://elxea.com/api/line-login/init", {
            "user-agent": userAgent,
          }),
        ),
      ).toBe(expected);
    });
  }

  it("User-Agent が無いときは切り替えない（分からないものを内部仕様側へ倒さない）", () => {
    expect(
      lineAppHandoffFromRequest(request("https://elxea.com/api/line-login/init")),
    ).toBe(false);
  });
});

describe("全経路が UA で同じ判断をする（経路ごとに分かれないこと）", () => {
  for (const route of AUTHORIZE_URL_ROUTES) {
    it(`${route.name} — iPhone の Chrome では受け渡し URL を返す`, async () => {
      const url = new URL(await route.run(UA.iosChrome));
      expect(url.host).toBe("access-auto.line.me");
      expect(url.pathname).toBe(LINE_APP_HANDOFF_PATH);

      const inner = authorizeRequestInside(url);
      expect(inner.searchParams.get("response_type")).toBe("code");
      expect(inner.searchParams.get("state")).toBeTruthy();
      expect(inner.searchParams.get("nonce")).toBeTruthy();
      for (const p of AUTO_LOGIN_KILLING_PARAMS) {
        expect(inner.searchParams.has(p)).toBe(false);
      }
    });

    it(`${route.name} — iOS Safari では今日どおり access.line.me を返す（退行検査）`, async () => {
      const url = new URL(await route.run(UA.iosSafari));
      expect(url.host).toBe("access.line.me");
      expect(url.pathname).toBe("/oauth2/v2.1/authorize");
    });

    it(`${route.name} — Android では今日どおり access.line.me を返す（退行検査）`, async () => {
      const url = new URL(await route.run(UA.androidChrome));
      expect(url.host).toBe("access.line.me");
      expect(url.pathname).toBe("/oauth2/v2.1/authorize");
    });
  }
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
