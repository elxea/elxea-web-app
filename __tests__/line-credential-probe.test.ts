/**
 * 「誰も踏まなくても設定破壊が分かる」プローブの判定を固定する。
 *
 * ## これが埋めている穴
 *
 * 2026-08-22 と 2026-08-25、Channel Secret 側の設定破壊で token 交換が全滅した。
 * どちらも **コードは無傷で CI も E2E も緑**。既存のヘルスプローブ 2 本
 * (`/api/line-login` の 307 / `/api/user/line-link/init` の 401) も緑のまま通り抜けた —
 * あの 2 本はチャネル ID しか使わないので、Secret が壊れていても答えが変わらない。
 *
 * このプローブは LINE に実際に問い合わせて資格情報の可否を答える。だから
 * **判定の向きが崩れると、監視が嘘をつく**。ここで固定するのはその向きである。
 */
import { describe, expect, it, vi } from "vitest";

import {
  probeChannelCredentials,
  verdictHttpStatus,
  worstVerdict,
} from "@/lib/line/credential-probe";

const CREDS = {
  channelId: "2011239425",
  channelSecret: "a".repeat(32),
  redirectUri: "https://elxea.com/api/line-callback",
};

/** LINE の token endpoint の応答を差し替える。 */
function stubLine(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("probeChannelCredentials", () => {
  it("invalid_grant なら『資格情報は通っている』と答える", async () => {
    /* 期待どおりの姿。こちらが送れるのは必ず無効なコードなので、資格情報が
       正しければ LINE はグラント側で拒む。 */
    const result = await probeChannelCredentials({
      ...CREDS,
      fetchImpl: stubLine(400, { error: "invalid_grant" }) as unknown as typeof fetch,
    });
    expect(result.verdict).toBe("ok");
  });

  it("invalid_client なら設定破壊と答える", async () => {
    const result = await probeChannelCredentials({
      ...CREDS,
      fetchImpl: stubLine(400, {
        error: "invalid_client",
        error_description: "invalid client_secret",
      }) as unknown as typeof fetch,
    });
    expect(result.verdict).toBe("misconfigured");
  });

  it("知らない 400 でも『壊れている』とは言わない", async () => {
    /* LINE はエラーコード一覧を公開していない。知らないコードを設定破壊に
       倒すと、LINE の仕様変更の日から監視が鳴りっぱなしになる。 */
    const result = await probeChannelCredentials({
      ...CREDS,
      fetchImpl: stubLine(400, { error: "something_new" }) as unknown as typeof fetch,
    });
    expect(result.verdict).toBe("ok");
  });

  it.each([500, 502, 429])("LINE が %i を返したら unknown (異常なしにしない)", async (status) => {
    const result = await probeChannelCredentials({
      ...CREDS,
      fetchImpl: stubLine(status, { error: "server_error" }) as unknown as typeof fetch,
    });
    expect(result.verdict).toBe("unknown");
  });

  it("到達できなければ unknown。投げない", async () => {
    const result = await probeChannelCredentials({
      ...CREDS,
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    expect(result.verdict).toBe("unknown");
    expect(result.detail).toContain("TypeError");
  });

  it("無効なコードが受理されたら unknown (前提が崩れている)", async () => {
    /* 2xx はありえない。ありえないことが起きたなら「資格情報 OK」ではなく
       「このプローブの前提が崩れた」と報告する。 */
    const result = await probeChannelCredentials({
      ...CREDS,
      fetchImpl: stubLine(200, { access_token: "at" }) as unknown as typeof fetch,
    });
    expect(result.verdict).toBe("unknown");
  });

  it.each([
    ["id が無い", { channelId: undefined }],
    ["secret が無い", { channelSecret: undefined }],
    ["両方無い", { channelId: undefined, channelSecret: undefined }],
  ])("%s なら not-configured。LINE を叩かない", async (_label, override) => {
    const fetchImpl = stubLine(400, { error: "invalid_grant" });
    const result = await probeChannelCredentials({
      ...CREDS,
      ...override,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.verdict).toBe("not-configured");
    /* 「設定が無い」と「設定が壊れている」を混ぜない。空の資格情報を LINE に
       送ると、設定漏れが LINE 由来のエラーに化けて原因が分からなくなる。 */
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("秘密を本文に載せない (公開エンドポイントに出る値)", async () => {
    const secret = "s3cr3t-channel-secret-value-here";
    const result = await probeChannelCredentials({
      ...CREDS,
      channelSecret: secret,
      fetchImpl: stubLine(400, {
        error: "invalid_client",
        error_description: `bad secret ${secret}`,
      }) as unknown as typeof fetch,
    });
    expect(result.detail).not.toContain(secret);
    /* `error_description` は LINE が自由に書ける欄。丸ごと転記すると、LINE が
       そこに何を入れても公開エンドポイントに出てしまう。 */
    expect(result.detail).not.toContain("bad secret");
  });

  it("token endpoint に必要な形で投げている", async () => {
    const fetchImpl = stubLine(400, { error: "invalid_grant" });
    await probeChannelCredentials({ ...CREDS, fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/oauth2/v2.1/token");
    expect(init.method).toBe("POST");

    const params = new URLSearchParams(String(init.body));
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("client_id")).toBe(CREDS.channelId);
    expect(params.get("client_secret")).toBe(CREDS.channelSecret);
    /* コードは必ず無効な固定値。本物の認可コードを消費しない。 */
    expect(params.get("code")).toMatch(/health-probe/);
  });
});

describe("worstVerdict — 一番悪いものに倒す", () => {
  it("片方でも misconfigured なら全体は misconfigured", () => {
    expect(worstVerdict(["ok", "misconfigured"])).toBe("misconfigured");
    expect(worstVerdict(["misconfigured", "ok"])).toBe("misconfigured");
  });

  it("not-configured は unknown より重い", () => {
    /* 「判定できなかった」より「そもそも設定が無い」の方が確定した悪い事実。 */
    expect(worstVerdict(["unknown", "not-configured"])).toBe("not-configured");
  });

  it("全部 ok のときだけ ok", () => {
    expect(worstVerdict(["ok", "ok"])).toBe("ok");
    expect(worstVerdict(["ok", "unknown"])).toBe("unknown");
  });

  it("空なら unknown (何も見ていない状態を緑にしない)", () => {
    expect(worstVerdict([])).toBe("unknown");
  });
});

describe("verdictHttpStatus — ステータスしか見ない監視にも伝える", () => {
  it.each([
    ["ok", 200],
    ["unknown", 502],
    ["not-configured", 503],
    ["misconfigured", 503],
  ] as const)("%s → %i", (verdict, status) => {
    expect(verdictHttpStatus(verdict)).toBe(status);
  });
});
