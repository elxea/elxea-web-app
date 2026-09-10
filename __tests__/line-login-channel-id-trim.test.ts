/**
 * ログイン認可 URL の `client_id` は **trim された** `AUTH_LINE_ID` である
 * (設計憲章 R4 / Wave 0)。
 *
 * ## 何を防いでいるか
 *
 * `AUTH_LINE_ID` を読む経路は 4 本ある:
 *
 *   - `GET  /api/line-login`        … 認可 URL を組む (302)
 *   - `POST /api/line-login/init`   … 認可 URL を組む (JSON)
 *   - `/api/line-callback`          … token 交換
 *   - `/api/health/line`            … ヘルスチェック
 *
 * 後ろの 2 本は以前から `resolveLoginChannelId()` (= `readSecretEnvTrimmed`) を
 * 通していたが、**認可 URL を組む前の 2 本だけが `process.env.AUTH_LINE_ID` を
 * 生で読んでいた**。`lib/line/login-channel.ts` は自分を「この 2 本を読む唯一の
 * 入口」と称しているのに、実際には守られていなかった。
 *
 * 差は trim ひとつだが、`vercel env add NAME production < file` で入れた値は
 * **末尾の改行まで保存される** (経緯は `lib/env.ts` 冒頭)。そうなると:
 *
 *   - 認可 URL は `client_id=2011239425%0A` (生読み) で LINE に飛ぶ
 *   - token 交換とヘルスチェックは `2011239425` (trim 済み) を使う
 *
 * つまり **ヘルスチェックは緑のまま、ログインだけが落ちる**。2026-08-25 の本番
 * 障害 (`AUTH_LINE_SECRET` 不一致で token 交換が全滅) がこの形だった。沈黙する
 * 壊れ方なので、検査が無いと再発しても気付けない。
 *
 * ## この検査が捕まえる変異
 *
 * どちらかの route を `process.env.AUTH_LINE_ID` の生読みに戻すと、`client_id` に
 * 空白が残って落ちる。callback 側は `__tests__/line-callback-failure-exits.test.ts`
 * が既に同じ性質を固定しているので、4 本すべてが揃って守られる。
 *
 * ⚠ ここで見ているのは **ログイン用の `AUTH_LINE_ID`** である。連携 (LIFF) 用の
 *   `LINE_LIFF_CHANNEL_ID` は**別チャネルを指す別の env** で、揃えるべきものでは
 *   ない (`app/api/line-login/init/route.ts` の注記および
 *   `__tests__/line-link-liff-route.test.ts` を参照)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

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

/** 実際に踏んだ壊れ方: 標準入力経由の登録で末尾に改行が残った値。 */
const CHANNEL_ID = "2011239425";
const UNTRIMMED = `  ${CHANNEL_ID}\n`;

beforeEach(() => {
  vi.clearAllMocks();
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

describe("認可 URL の client_id は trim 済みの AUTH_LINE_ID", () => {
  it("POST /api/line-login/init — 前後の空白・改行を落とす", async () => {
    process.env.AUTH_LINE_ID = UNTRIMMED;

    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(request("https://www.elxea.com/api/line-login/init"));
    const { authUrl } = (await res.json()) as { authUrl: string };

    const clientId = new URL(authUrl).searchParams.get("client_id");
    expect(clientId).toBe(CHANNEL_ID);
    /* 「たまたま含まれている」ではなく「余計な文字が無い」ことを見る。
       生読みに戻すと %0A が入るので、この 2 行のどちらかが必ず落ちる。 */
    expect(clientId).not.toMatch(/\s/);
  });

  it("GET /api/line-login — 前後の空白・改行を落とす", async () => {
    process.env.AUTH_LINE_ID = UNTRIMMED;

    const { GET } = await import("@/app/api/line-login/route");
    const res = await GET(request("https://www.elxea.com/api/line-login"));

    const clientId = new URL(res.headers.get("location")!).searchParams.get(
      "client_id",
    );
    expect(clientId).toBe(CHANNEL_ID);
    expect(clientId).not.toMatch(/\s/);
  });

  it("2 本の route が同じ client_id を出す (片方だけ直す事故を防ぐ)", async () => {
    process.env.AUTH_LINE_ID = UNTRIMMED;

    const { POST } = await import("@/app/api/line-login/init/route");
    const { GET } = await import("@/app/api/line-login/route");

    const initRes = await POST(request("https://www.elxea.com/api/line-login/init"));
    const { authUrl } = (await initRes.json()) as { authUrl: string };
    const legacyRes = await GET(request("https://www.elxea.com/api/line-login"));

    const fromInit = new URL(authUrl).searchParams.get("client_id");
    const fromLegacy = new URL(legacyRes.headers.get("location")!).searchParams.get(
      "client_id",
    );

    expect(fromInit).toBe(fromLegacy);
  });

  /**
   * 空白だけの値は「設定されている」ではなく「未設定」。
   *
   * 生読みだと `"   "` は truthy なので、**空白を client_id にして LINE へ飛ばす**。
   * LINE 側では認可エラーになり、こちらのログには「設定済み」としか残らない。
   * trim して `undefined` に落ちれば、意図どおり 503 (未設定) を返せる。
   */
  it("空白だけの AUTH_LINE_ID は未設定として 503 を返す", async () => {
    process.env.AUTH_LINE_ID = "   \n";

    const { POST } = await import("@/app/api/line-login/init/route");
    const res = await POST(request("https://www.elxea.com/api/line-login/init"));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "auth_not_configured" });
  });
});
