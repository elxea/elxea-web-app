/**
 * `/api/line-callback` の **失敗の出口**が正しく振る舞うかを固定する。
 *
 * 成功経路は `line-callback-session-cookies.test.ts`、id_token のゲートは
 * `line-callback-nonce.test.ts` が見ている。ここは「往復が失敗で終わったとき」だけ。
 *
 * ## 何を直したのか
 *
 * ### 1. キャンセルの掃除漏れ
 *
 * `clearState` は state 照合のあとで定義されていたので、**`if (error)` の枝だけが
 * 掃除を通らなかった**。LINE 側でユーザーが「キャンセル」を押すとこの枝に来る —
 * つまり一番踏まれる失敗の出口が、使い捨ての `line_oauth_state` /
 * `line_oauth_nonce` を残したまま login に戻していた。値は自然失効 (10 分) まで
 * ブラウザに残り、次の往復がその古い値と突き合わせられる状態が生まれる。
 *
 * ### 2. 直らない失敗を「もう一度お試しください」に畳んでいた
 *
 * token 交換の失敗は `invalid_client` (= こちらのチャネル設定が壊れている。
 * 何度やり直しても直らない) も含めて全部 `?error=TokenFailed` に落ちていた。
 * 2026-08-22 / 2026-08-25 の本番障害の間、画面はひたすら再試行を勧め続けた。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const STATE = "state-value-for-test";
const NONCE = "nonce-value-for-test";

const mockCaptureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage: mockCaptureMessage }));

let presentedCookies: Record<string, string> = {};
const cookieStore = {
  get: vi.fn((name: string) =>
    presentedCookies[name] === undefined ? undefined : { name, value: presentedCookies[name] },
  ),
  set: vi.fn(),
  delete: vi.fn(),
  has: vi.fn(() => false),
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

/** 往復ごとの使い捨て cookie。どの失敗の出口でも必ず落ちていなければならない。 */
const ONE_SHOT_COOKIES = ["line_oauth_state", "line_oauth_nonce"] as const;

const SAVED = {
  AUTH_LINE_ID: process.env.AUTH_LINE_ID,
  AUTH_LINE_SECRET: process.env.AUTH_LINE_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
};

beforeEach(() => {
  vi.clearAllMocks();
  presentedCookies = { line_oauth_state: STATE, line_oauth_nonce: NONCE };
  process.env.AUTH_LINE_ID = "test-channel";
  process.env.AUTH_LINE_SECRET = "test-secret";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://www.elxea.com";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

type Directive = { name: string; expired: boolean };

function parseSetCookies(res: Response): Directive[] {
  return res.headers.getSetCookie().map((raw) => {
    const [nameValue, ...attrs] = raw.split(";").map((s) => s.trim());
    const d: Directive = { name: nameValue.slice(0, nameValue.indexOf("=")), expired: false };
    for (const attr of attrs) {
      const [k, v] = attr.split("=");
      if (k.toLowerCase() === "max-age" && Number(v) <= 0) d.expired = true;
      if (k.toLowerCase() === "expires" && new Date(v).getTime() <= Date.now()) d.expired = true;
    }
    return d;
  });
}

/** 使い捨て cookie が「両方のスコープで」期限切れにされていることを見る。 */
function expectOneShotCookiesCleared(res: Response) {
  const directives = parseSetCookies(res);
  for (const name of ONE_SHOT_COOKIES) {
    const forName = directives.filter((d) => d.name === name);
    expect(forName.length, `${name} の掃除ディレクティブが無い`).toBeGreaterThan(0);
    for (const d of forName) {
      expect(d.expired, `${name} が期限切れになっていない`).toBe(true);
    }
  }
}

async function callCallback(query: string) {
  const { GET } = await import("@/app/api/line-callback/route");
  const host = "www.elxea.com";
  const req = new NextRequest(`https://${host}/api/line-callback?${query}`, {
    headers: { host, "x-forwarded-proto": "https" },
  });
  return GET(req);
}

describe("LINE 側で失敗して戻ってきたとき (?error=)", () => {
  it("使い捨ての state / nonce を必ず落とす", async () => {
    /* ユーザーが LINE の同意画面でキャンセルした場合の枝。以前ここだけが
       掃除を通らず、使い捨ての値がブラウザに残っていた。 */
    const res = await callCallback("error=access_denied");
    expectOneShotCookiesCleared(res);
  });

  it("login へ戻し、セッションは作らない", async () => {
    const res = await callCallback("error=access_denied");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/ja/login?error=LineAuthFailed");

    const names = parseSetCookies(res).map((d) => d.name);
    for (const sessionCookie of ["line_user", "line_auth", "line_uid", "line_session"]) {
      expect(names).not.toContain(sessionCookie);
    }
  });

  it("LINE を一切呼ばない (認可が成立していないので呼ぶ相手がいない)", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    await callCallback("error=access_denied");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("token 交換が invalid_client で落ちたとき", () => {
  function stubTokenFailure(body: unknown, status = 400) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("oauth2/v2.1/token")) {
          return new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      }),
    );
  }

  it("TokenFailed ではなく MisconfiguredChannel へ倒す", async () => {
    /* ここが分かれていないと、直らない失敗に「もう一度お試しください」を出して
       無限リトライへ誘導することになる。 */
    stubTokenFailure({ error: "invalid_client", error_description: "invalid client_secret" });
    const res = await callCallback(`code=abc&state=${STATE}`);
    expect(res.headers.get("location")).toContain("error=MisconfiguredChannel");
  });

  it("Sentry に subsystem=identity-link の error で即時に上げる", async () => {
    stubTokenFailure({ error: "invalid_client" });
    await callCallback(`code=abc&state=${STATE}`);

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [, options] = mockCaptureMessage.mock.calls[0] as [
      string,
      { level: string; tags: Record<string, string> },
    ];
    expect(options.level).toBe("error");
    expect(options.tags.subsystem).toBe("identity-link");
    expect(options.tags.source).toBe("line-callback");
  });

  it("使い捨ての state / nonce を落とす", async () => {
    stubTokenFailure({ error: "invalid_client" });
    const res = await callCallback(`code=abc&state=${STATE}`);
    expectOneShotCookiesCleared(res);
  });

  it("invalid_grant は従来どおり TokenFailed のまま (再試行で直りうる)", async () => {
    stubTokenFailure({ error: "invalid_grant" });
    const res = await callCallback(`code=abc&state=${STATE}`);
    expect(res.headers.get("location")).toContain("error=TokenFailed");
    /* こちらは設定破壊ではないので Sentry を鳴らさない。鳴らすと、期限切れの
       コードで戻ってきた人の数だけアラートが出て、本物が埋もれる。 */
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("本文が読めない 400 も TokenFailed に倒す (設定破壊と断定しない)", async () => {
    stubTokenFailure("<html>bad gateway</html>");
    const res = await callCallback(`code=abc&state=${STATE}`);
    expect(res.headers.get("location")).toContain("error=TokenFailed");
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

describe("AUTH_LINE_* は trim して読む", () => {
  it("末尾改行付きの secret でも LINE には掃除した値を送る", async () => {
    /* `vercel env add NAME production < file` は末尾改行まで保存する。連携側は
       2026-08-22 にこれで壊れて trim 済みだったが、ログイン側だけ生読みが
       残っていた。コードを不感にすることでしか再発は防げない。 */
    process.env.AUTH_LINE_SECRET = "test-secret\n";
    process.env.AUTH_LINE_ID = " test-channel ";

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("oauth2/v2.1/token")) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    await callCallback(`code=abc&state=${STATE}`);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const params = new URLSearchParams(String(init.body));
    expect(params.get("client_secret")).toBe("test-secret");
    expect(params.get("client_id")).toBe("test-channel");
  });
});
