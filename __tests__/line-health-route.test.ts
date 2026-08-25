/**
 * `/api/health/line` — 設定破壊を「誰も踏まなくても」検知する入口。
 *
 * ## ここで守っていること
 *
 * 1. **判定が本文と HTTP ステータスの両方に出る。** 本文だけだと、ステータスしか
 *    見ない汎用の死活監視が緑と誤認する。ステータスだけだと「壊れている」と
 *    「LINE に到達できなかった」が同じ 5xx に潰れる。
 * 2. **秘密を出さない。** このエンドポイントは認証を掛けていない (掛けると
 *    GitHub Actions の監視から叩けない)。安全は「何も漏らさない」ことで担保して
 *    いるので、応答に channel id / secret / LINE の `error_description` が
 *    混ざっていないことを機械的に見る。
 * 3. **キャッシュが効く。** 認証が無い = 誰でも叩ける = 1 リクエストごとに LINE へ
 *    往復させられる、が成り立ってしまう。
 *
 * route module 内にキャッシュを持つので、各テストは `vi.resetModules()` +
 * 動的 import でモジュールごと入れ替えて素の状態から始める。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const LOGIN_ID = "2011239425";
const LOGIN_SECRET = "login-secret-0123456789abcdef01";
const LINK_ID = "2011239425";
const LINK_SECRET = "link-secret-0123456789abcdef0123";

const SAVED = {
  AUTH_LINE_ID: process.env.AUTH_LINE_ID,
  AUTH_LINE_SECRET: process.env.AUTH_LINE_SECRET,
  LINE_LIFF_CHANNEL_ID: process.env.LINE_LIFF_CHANNEL_ID,
  LINE_LIFF_CHANNEL_SECRET: process.env.LINE_LIFF_CHANNEL_SECRET,
  LINE_LOGIN_CHANNEL_SECRET: process.env.LINE_LOGIN_CHANNEL_SECRET,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

beforeEach(() => {
  vi.resetModules();
  process.env.AUTH_LINE_ID = LOGIN_ID;
  process.env.AUTH_LINE_SECRET = LOGIN_SECRET;
  process.env.LINE_LIFF_CHANNEL_ID = LINK_ID;
  process.env.LINE_LIFF_CHANNEL_SECRET = LINK_SECRET;
  process.env.NEXT_PUBLIC_SITE_URL = "https://elxea.com";
  delete process.env.LINE_LOGIN_CHANNEL_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/**
 * token endpoint の応答を `client_secret` ごとに切り替える。実物と同じく
 * 「どの資格情報で来たか」で答えが変わる LINE を模す。
 */
function stubLineBySecret(bySecret: Record<string, { status: number; body: unknown }>) {
  const impl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const secret = new URLSearchParams(String(init?.body)).get("client_secret") ?? "";
    const answer = bySecret[secret] ?? { status: 400, body: { error: "invalid_grant" } };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

async function callHealth() {
  const { GET } = await import("@/app/api/health/line/route");
  const res = await GET();
  return { res, body: (await res.json()) as Record<string, unknown> };
}

describe("GET /api/health/line", () => {
  it("両チャネルとも invalid_grant なら 200 / status=ok", async () => {
    stubLineBySecret({
      [LOGIN_SECRET]: { status: 400, body: { error: "invalid_grant" } },
      [LINK_SECRET]: { status: 400, body: { error: "invalid_grant" } },
    });

    const { res, body } = await callHealth();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect((body.channels as Record<string, { verdict: string }>).login.verdict).toBe("ok");
    expect((body.channels as Record<string, { verdict: string }>).link.verdict).toBe("ok");
  });

  it("ログイン用の secret が壊れていたら 503 / status=misconfigured", async () => {
    /* 2026-08-25 の本番障害そのもの。連携側は無事でもログインは全滅する。 */
    stubLineBySecret({
      [LOGIN_SECRET]: { status: 400, body: { error: "invalid_client" } },
      [LINK_SECRET]: { status: 400, body: { error: "invalid_grant" } },
    });

    const { res, body } = await callHealth();
    expect(res.status).toBe(503);
    expect(body.status).toBe("misconfigured");
    const channels = body.channels as Record<string, { verdict: string }>;
    expect(channels.login.verdict).toBe("misconfigured");
    /* 片方が無事でも全体は赤。「半分正常」という状態は利用者には無い。 */
    expect(channels.link.verdict).toBe("ok");
  });

  it("連携用の secret が壊れていても全体は赤になる", async () => {
    /* 2026-08-22 の本番障害。ログインだけ通り続けたので「連携の不具合」に見えた。 */
    stubLineBySecret({
      [LOGIN_SECRET]: { status: 400, body: { error: "invalid_grant" } },
      [LINK_SECRET]: { status: 400, body: { error: "invalid_client" } },
    });

    const { res, body } = await callHealth();
    expect(res.status).toBe(503);
    expect(body.status).toBe("misconfigured");
  });

  it("env が無ければ not-configured (壊れているとは言わない)", async () => {
    delete process.env.AUTH_LINE_SECRET;
    stubLineBySecret({ [LINK_SECRET]: { status: 400, body: { error: "invalid_grant" } } });

    const { res, body } = await callHealth();
    expect(res.status).toBe(503);
    expect(body.status).toBe("not-configured");
  });

  it("LINE に到達できなければ 502 / status=unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const { res, body } = await callHealth();
    expect(res.status).toBe(502);
    expect(body.status).toBe("unknown");
  });

  it("末尾改行が混ざった env でも判定が変わらない (trim される)", async () => {
    /* `vercel env add NAME production < file` は末尾改行まで保存する。それが
       2026-08-22 の直接原因だった。ここが緩むと、健全な値なのに health が
       赤くなる (あるいはその逆) が起こる。 */
    process.env.AUTH_LINE_SECRET = `${LOGIN_SECRET}\n`;
    process.env.LINE_LIFF_CHANNEL_SECRET = ` ${LINK_SECRET} `;
    stubLineBySecret({
      [LOGIN_SECRET]: { status: 400, body: { error: "invalid_grant" } },
      [LINK_SECRET]: { status: 400, body: { error: "invalid_grant" } },
    });

    const { body } = await callHealth();
    expect(body.status).toBe("ok");
  });

  it("応答に秘密を載せない", async () => {
    stubLineBySecret({
      [LOGIN_SECRET]: {
        status: 400,
        body: {
          error: "invalid_client",
          error_description: `client_secret ${LOGIN_SECRET} is wrong`,
        },
      },
      [LINK_SECRET]: { status: 400, body: { error: "invalid_grant" } },
    });

    const { body } = await callHealth();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(LOGIN_SECRET);
    expect(serialized).not.toContain(LINK_SECRET);
    /* channel id も出さない。判定に要らない値は出さないのが既定。 */
    expect(serialized).not.toContain(LOGIN_ID);
  });

  it("短時間の連打は LINE に往復させない", async () => {
    const impl = stubLineBySecret({
      [LOGIN_SECRET]: { status: 400, body: { error: "invalid_grant" } },
      [LINK_SECRET]: { status: 400, body: { error: "invalid_grant" } },
    });

    const { GET } = await import("@/app/api/health/line/route");
    const first = await GET();
    expect((await first.json()).cached).toBe(false);
    // 2 チャネル分 = 2 往復。
    expect(impl).toHaveBeenCalledTimes(2);

    const second = await GET();
    expect((await second.json()).cached).toBe(true);
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("CDN に持たせない", async () => {
    stubLineBySecret({
      [LOGIN_SECRET]: { status: 400, body: { error: "invalid_grant" } },
      [LINK_SECRET]: { status: 400, body: { error: "invalid_grant" } },
    });
    const { res } = await callHealth();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
