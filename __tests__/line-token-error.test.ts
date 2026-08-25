/**
 * token 交換の失敗を「設定破壊」と「その回限りの失敗」に分ける判定を固定する。
 *
 * ## なぜ固定するのか
 *
 * この分類が崩れると、直し方が正反対の 2 つの状態が同じ文言に畳まれる。
 *
 *   - `invalid_client` … client_id / client_secret の組が拒否された。
 *     **何度やり直しても直らない**。復旧作業が要る。
 *   - それ以外        … 認可コード側の問題。やり直せば直りうる。
 *
 * 2026-08-22 と 2026-08-25 の本番障害はどちらも前者で、画面はその間ずっと
 * 「もう一度お試しください」と案内し続けていた。ここが緩むとその状態に戻る。
 *
 * ## 判定の向きも固定する
 *
 * LINE は token endpoint のエラーコード一覧を公開していない。だから
 * 「`invalid_grant` のときだけ資格情報 OK」という書き方をしてはいけない —
 * LINE が検査順やコードを変えた日から、ヘルスチェックが恒常的に鳴り続ける。
 * `invalid_client` **だけ**を積極的な証拠として使う向きを、テストで固定する。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  classifyTokenExchangeError,
  readOAuthErrorCode,
  reportMisconfiguredChannel,
} from "@/lib/line/token-error";

/* `vi.mock` の factory は hoist されるので、外の変数を掴むには `vi.hoisted` で
   一緒に巻き上げる必要がある (vitest の制約)。 */
const mockCaptureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage: mockCaptureMessage }));

describe("classifyTokenExchangeError", () => {
  it("invalid_client は設定破壊として分類する", () => {
    const body = JSON.stringify({
      error: "invalid_client",
      error_description: "invalid client_secret",
    });
    expect(classifyTokenExchangeError(400, body)).toEqual({
      kind: "misconfigured-channel",
      code: "invalid_client",
    });
  });

  it("invalid_grant は grant 側の失敗として分類する (資格情報は通っている)", () => {
    const body = JSON.stringify({ error: "invalid_grant" });
    expect(classifyTokenExchangeError(400, body)).toEqual({
      kind: "bad-grant",
      code: "invalid_grant",
    });
  });

  it.each(["invalid_request", "unsupported_grant_type", "unauthorized_client"])(
    "%s も『資格情報は拒否されていない』側に倒す",
    (code) => {
      /* 保守的な向き。LINE が知らないコードを返し始めても、資格情報が壊れたとは
         言わない。逆向きだと、その日からヘルスチェックが鳴りっぱなしになる。 */
      expect(classifyTokenExchangeError(400, JSON.stringify({ error: code })).kind).toBe(
        "bad-grant",
      );
    },
  );

  it("400 なら本文が壊れていても bad-grant (LINE が判断を下した証拠はある)", () => {
    expect(classifyTokenExchangeError(400, "<html>gateway</html>")).toEqual({
      kind: "bad-grant",
      code: null,
    });
  });

  it.each([500, 502, 429, 0])("400 以外 (%i) は unknown — 異常なしにも破壊にもしない", (status) => {
    expect(classifyTokenExchangeError(status, "").kind).toBe("unknown");
  });

  it("ステータスが 400 以外でも invalid_client なら設定破壊", () => {
    /* 401 で返す実装に LINE が変えても、コードが invalid_client である以上、
       資格情報が拒否された事実は変わらない。 */
    const body = JSON.stringify({ error: "invalid_client" });
    expect(classifyTokenExchangeError(401, body).kind).toBe("misconfigured-channel");
  });
});

describe("readOAuthErrorCode — タグに載せてよい形だけ通す", () => {
  it("OAuth の error コードを取り出す", () => {
    expect(readOAuthErrorCode(JSON.stringify({ error: "invalid_client" }))).toBe(
      "invalid_client",
    );
  });

  it.each([
    ["JSON でない", "not json"],
    ["error が無い", JSON.stringify({ message: "nope" })],
    ["error が文字列でない", JSON.stringify({ error: 42 })],
    ["null 本体", "null"],
  ])("%s なら null", (_label, body) => {
    expect(readOAuthErrorCode(body)).toBeNull();
  });

  it("識別子めいた値が紛れていても弾く", () => {
    /* コードはログと Sentry のタグ、さらに公開エンドポイントの本文に載る。
       RFC 6749 の語彙 (`[a-z_]`) から外れるものを通すと、LINE が将来ここに
       何を入れても素通りしてしまう。 */
    for (const raw of ["U0123456789abcdef", "invalid client", "a".repeat(41), "ERROR"]) {
      expect(readOAuthErrorCode(JSON.stringify({ error: raw }))).toBeNull();
    }
  });
});

describe("reportMisconfiguredChannel", () => {
  beforeEach(() => {
    mockCaptureMessage.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subsystem=identity-link の error レベルで Sentry に上げる", () => {
    reportMisconfiguredChannel({
      source: "line-callback",
      channel: "login",
      code: "invalid_client",
    });

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = mockCaptureMessage.mock.calls[0] as [
      string,
      { level: string; tags: Record<string, string> },
    ];
    expect(message).toContain("invalid_client");
    expect(options.level).toBe("error");
    expect(options.tags.subsystem).toBe("identity-link");
    expect(options.tags.source).toBe("line-callback");
    expect(options.tags.channel).toBe("login");
    expect(options.tags.line_error).toBe("invalid_client");
  });

  it("コードが読めなくても報告は出す (黙らない)", () => {
    reportMisconfiguredChannel({ source: "line-link-callback", channel: "link", code: null });
    const [, options] = mockCaptureMessage.mock.calls[0] as [
      string,
      { tags: Record<string, string> },
    ];
    expect(options.tags.line_error).toBe("unknown");
  });

  it("秘密を載せない", () => {
    reportMisconfiguredChannel({
      source: "line-callback",
      channel: "login",
      code: "invalid_client",
    });
    /* 呼び出し側は channel id も secret も渡せないシグネチャになっている。
       ここではその契約が実際の payload で保たれていることを確かめる。 */
    const serialized = JSON.stringify(mockCaptureMessage.mock.calls[0]).toLowerCase();
    for (const term of ["secret", "client_id", "channel_id"]) {
      expect(serialized).not.toContain(term);
    }
  });
});
