/**
 * LINE 接続先ホストの env 化の契約テスト（lib/line/endpoints.ts）。
 *
 * 守りたいことは 2 つあり、どちらも落とせない:
 *
 *   1. **既定は本物の LINE**。env 未設定なら組み立てられる URL は env 化前と一字一句同じ。
 *      本番は env を足さないので、ここが崩れると本番の LINE ログインが黙って壊れる。
 *   2. **設定すれば本当に差し替わる**。差し替えられなければ、この env 化を入れた目的
 *      （偽 LINE サーバーへ向けたサーバ間通信の自動テスト）が達成されない。
 *
 * env を触るので、各テストの後で必ず元に戻す。
 */
import { describe, it, expect, afterEach, vi } from "vitest";

import {
  LINE_API_BASE_URL_DEFAULT,
  LINE_APP_HANDOFF_BASE_URL_DEFAULT,
  LINE_APP_HANDOFF_PATH,
  LINE_AUTH_BASE_URL_DEFAULT,
  lineApiBaseUrl,
  lineAppHandoffBaseUrl,
  lineAuthBaseUrl,
  lineAuthRedirectPrefix,
} from "@/lib/line/endpoints";
import { verifyLineIdToken } from "@/lib/line/verify-liff-token";

const ENV_KEYS = [
  "LINE_AUTH_BASE_URL",
  "LINE_API_BASE_URL",
  "LINE_APP_HANDOFF_BASE_URL",
] as const;
const saved = new Map<string, string | undefined>(
  ENV_KEYS.map((k) => [k, process.env[k]]),
);

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("LINE ベース URL の既定値（env 未設定 = 本番の状態）", () => {
  it("認可ホストは本物の access.line.me", () => {
    delete process.env.LINE_AUTH_BASE_URL;
    expect(lineAuthBaseUrl()).toBe("https://access.line.me");
    expect(lineAuthBaseUrl()).toBe(LINE_AUTH_BASE_URL_DEFAULT);
  });

  it("API ホストは本物の api.line.me", () => {
    delete process.env.LINE_API_BASE_URL;
    expect(lineApiBaseUrl()).toBe("https://api.line.me");
    expect(lineApiBaseUrl()).toBe(LINE_API_BASE_URL_DEFAULT);
  });

  it("組み立てた URL が env 化前のリテラルと完全一致する（本番無影響の実証）", () => {
    delete process.env.LINE_AUTH_BASE_URL;
    delete process.env.LINE_API_BASE_URL;

    expect(`${lineAuthBaseUrl()}/oauth2/v2.1/authorize`).toBe(
      "https://access.line.me/oauth2/v2.1/authorize",
    );
    expect(`${lineApiBaseUrl()}/oauth2/v2.1/token`).toBe("https://api.line.me/oauth2/v2.1/token");
    expect(`${lineApiBaseUrl()}/v2/profile`).toBe("https://api.line.me/v2/profile");
    expect(`${lineApiBaseUrl()}/oauth2/v2.1/verify`).toBe("https://api.line.me/oauth2/v2.1/verify");
    expect(`${lineApiBaseUrl()}/v2/bot/message/push`).toBe(
      "https://api.line.me/v2/bot/message/push",
    );
    expect(lineAuthRedirectPrefix()).toBe("https://access.line.me/");
  });

  it("空文字・空白のみは「未設定」と同じ扱い（既定値に落ちる）", () => {
    process.env.LINE_AUTH_BASE_URL = "";
    process.env.LINE_API_BASE_URL = "   \t\r\n ";
    expect(lineAuthBaseUrl()).toBe(LINE_AUTH_BASE_URL_DEFAULT);
    expect(lineApiBaseUrl()).toBe(LINE_API_BASE_URL_DEFAULT);
  });
});

describe("LINE ベース URL の差し替え（偽 LINE サーバー）", () => {
  it("認可ホストと API ホストを独立に差し替えられる", () => {
    process.env.LINE_AUTH_BASE_URL = "http://127.0.0.1:4010";
    delete process.env.LINE_API_BASE_URL;

    expect(lineAuthBaseUrl()).toBe("http://127.0.0.1:4010");
    // 片方だけ差し替えたとき、もう片方は本物のまま（1 本にまとめていないことの確認）。
    expect(lineApiBaseUrl()).toBe(LINE_API_BASE_URL_DEFAULT);
  });

  it("末尾改行が混ざっても壊れた URL にならない（vercel env add の貼り付け事故対策）", () => {
    process.env.LINE_API_BASE_URL = "http://127.0.0.1:4010\n";
    expect(lineApiBaseUrl()).toBe("http://127.0.0.1:4010");
    expect(`${lineApiBaseUrl()}/v2/profile`).toBe("http://127.0.0.1:4010/v2/profile");
  });

  it("末尾スラッシュ付きで入れても // にならない", () => {
    process.env.LINE_API_BASE_URL = "http://127.0.0.1:4010///";
    expect(`${lineApiBaseUrl()}/v2/profile`).toBe("http://127.0.0.1:4010/v2/profile");
  });
});

describe("lineAuthRedirectPrefix（オープンリダイレクト防止の許可前置き）", () => {
  it("既定では従来のリテラルと同一で、ホスト偽装を弾く", () => {
    delete process.env.LINE_AUTH_BASE_URL;
    const prefix = lineAuthRedirectPrefix();

    expect("https://access.line.me/dialog/bot/accountLink?linkToken=x".startsWith(prefix)).toBe(
      true,
    );
    // 末尾スラッシュが無いと通ってしまう類似ホスト。
    expect("https://access.line.me.evil.example/dialog".startsWith(prefix)).toBe(false);
    expect("https://evil.example/access.line.me/".startsWith(prefix)).toBe(false);
    expect("http://access.line.me/dialog".startsWith(prefix)).toBe(false);
  });

  it("差し替え時も末尾スラッシュ付きで、前方一致の緩みを作らない", () => {
    process.env.LINE_AUTH_BASE_URL = "http://127.0.0.1:4010";
    const prefix = lineAuthRedirectPrefix();

    expect(prefix).toBe("http://127.0.0.1:4010/");
    expect("http://127.0.0.1:4010/dialog/bot/accountLink".startsWith(prefix)).toBe(true);
    expect("http://127.0.0.1:40100/dialog".startsWith(prefix)).toBe(false);
  });
});

/**
 * サーバ間通信が実際に差し替え先へ向くことの実証。
 *
 * ここが本題: 呼び出し先 URL と、応答の `iss` 期待値の **両方** が env に追従しなければ、
 * 偽 LINE サーバーを立てても SUCCESS 経路を一度も通せない（必ず「iss が LINE でない」で落ちる）。
 */
describe("verifyLineIdToken が差し替え先へ向く", () => {
  const CHANNEL_ID = "2000000001";
  const VALID_SUB = "U0123456789abcdef0123456789abcdef";
  const VALID_TOKEN = "a".repeat(40);
  const FUTURE_EXP = 9999999999;

  function stubFetch(iss: string) {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sub: VALID_SUB, aud: CHANNEL_ID, iss, exp: FUTURE_EXP }),
      text: async () => "",
    })) as unknown as typeof fetch & { mock: { calls: unknown[][] } };
  }

  it("env 未設定なら本物の api.line.me を叩き、iss は access.line.me を要求する", async () => {
    delete process.env.LINE_AUTH_BASE_URL;
    delete process.env.LINE_API_BASE_URL;

    const fetchImpl = stubFetch("https://access.line.me");
    const res = await verifyLineIdToken(VALID_TOKEN, CHANNEL_ID, { fetchImpl });

    expect(res.ok).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.line.me/oauth2/v2.1/verify");
  });

  it("env 設定なら偽サーバーを叩き、偽サーバーの iss を受け入れる", async () => {
    process.env.LINE_AUTH_BASE_URL = "http://127.0.0.1:4010";
    process.env.LINE_API_BASE_URL = "http://127.0.0.1:4010";

    const fetchImpl = stubFetch("http://127.0.0.1:4010");
    const res = await verifyLineIdToken(VALID_TOKEN, CHANNEL_ID, { fetchImpl });

    expect(res.ok).toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://127.0.0.1:4010/oauth2/v2.1/verify");
  });

  it("差し替え中でも iss 検証は生きている（本物の LINE の iss は弾く）", async () => {
    process.env.LINE_AUTH_BASE_URL = "http://127.0.0.1:4010";
    process.env.LINE_API_BASE_URL = "http://127.0.0.1:4010";

    const res = await verifyLineIdToken(VALID_TOKEN, CHANNEL_ID, {
      fetchImpl: stubFetch("https://access.line.me"),
    });

    expect(res.ok).toBe(false);
  });
});

/**
 * LINE アプリ受け渡しホストの契約。
 *
 * 値の正本は **LINE が配っている association ファイル**であって、このリポジトリの
 * 定数ではない。実測（2026-08-30）:
 *
 *   https://access-auto.line.me/.well-known/apple-app-site-association
 *   → {"applinks":{"apps":[],"details":[{"appID":"ZW4U99SQQ3.jp.naver.line",
 *      "paths":["/dialog/oauth/weblogin","/oauth2/v2.1/login"]}]}}
 *
 *   https://access.line.me/.well-known/apple-app-site-association
 *   → HTTP 200 / 本文 0 バイト（= アプリに結び付いていない）
 *
 * ここを書き換えるときは、必ず上の 2 本を実際に引き直すこと。定数だけ動かすと
 * 「アプリが開かない」に静かに戻る。
 */
describe("LINE アプリ受け渡しホスト", () => {
  it("既定は access-auto.line.me（認可ホストとは別ホスト）", () => {
    delete process.env.LINE_APP_HANDOFF_BASE_URL;
    expect(lineAppHandoffBaseUrl()).toBe("https://access-auto.line.me");
    expect(lineAppHandoffBaseUrl()).toBe(LINE_APP_HANDOFF_BASE_URL_DEFAULT);
    expect(lineAppHandoffBaseUrl()).not.toBe(lineAuthBaseUrl());
  });

  it("パスは association ファイルに載っている値そのもの", () => {
    expect(LINE_APP_HANDOFF_PATH).toBe("/oauth2/v2.1/login");
  });

  it("env で偽サーバーへ差し替えられる（末尾スラッシュは落ちる）", () => {
    process.env.LINE_APP_HANDOFF_BASE_URL = "http://127.0.0.1:4010/";
    expect(lineAppHandoffBaseUrl()).toBe("http://127.0.0.1:4010");
  });

  it("空文字は未設定と同じ扱い（env を空で上書きしても本番が壊れない）", () => {
    process.env.LINE_APP_HANDOFF_BASE_URL = "";
    expect(lineAppHandoffBaseUrl()).toBe(LINE_APP_HANDOFF_BASE_URL_DEFAULT);
  });
});
