/**
 * 共有鍵（SYNC_API_SECRET）が壊れたときに、**沈黙しない**ことを固定する。
 *
 * ## 直している事故（2026-08-30 本番）
 *
 * cx-agent 側の secret が上書きされ、web-app から見て 401 になった。連携は
 * 両方向とも落ち、マイページの連携状態も読めなくなった。ところが本番に残った
 * 痕跡は次の 3 行の `console.warn` / `console.error` だけだった:
 *
 *   [line-link/callback] cx-agent returned 401: {"error":"Unauthorized"}
 *   [one-tap-link] cx-agent rejected the linkage (status=401)
 *   [line-linkage-status] forward lookup returned 401
 *
 * Vercel のログ保持は短く、翌日には読めない。結果「いつから壊れていたか」を
 * 誰も言えず、気付いたのは**オーナーが自分で連携を試した**ときだった。
 *
 * 401 は「連携できなかった 1 件」ではなく「全員が連携できない」。この検査は
 * その区別が実装から消えないことを守る。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import {
  isLedgerAuthRejection,
  probeLedgerSharedSecret,
  reportLedgerAuthFailure,
} from "@/lib/line/ledger-auth";

beforeEach(() => {
  captureMessage.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isLedgerAuthRejection — 401 だけを鍵の問題と読む", () => {
  it("401 は鍵の問題", () => {
    expect(isLedgerAuthRejection(401)).toBe(true);
  });

  /* 409（既に別の LINE と連携済み）は恒久的な衝突であって設定破壊ではない。
     ここに混ぜると、正常な業務上の拒否で監視が鳴り続ける。 */
  it("409 / 500 / 400 は鍵の問題ではない", () => {
    expect(isLedgerAuthRejection(409)).toBe(false);
    expect(isLedgerAuthRejection(500)).toBe(false);
    expect(isLedgerAuthRejection(400)).toBe(false);
    expect(isLedgerAuthRejection(403)).toBe(false);
  });
});

describe("reportLedgerAuthFailure — 設定破壊として上げる", () => {
  it("Sentry に上がる（ログだけで終わらせない）", () => {
    reportLedgerAuthFailure({ source: "line-link-callback", failure: "key-rejected" });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessage.mock.calls[0] as [
      string,
      { level: string; tags: Record<string, string> },
    ];
    expect(message).toContain("SYNC_API_SECRET");
    expect(options.level).toBe("error");
    expect(options.tags.source).toBe("line-link-callback");
    expect(options.tags.failure).toBe("key-rejected");
  });

  it("鍵が無い場合も上げる（誰も連携できない状態は同じ）", () => {
    reportLedgerAuthFailure({ source: "one-tap-link", failure: "secret-missing" });

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [, options] = captureMessage.mock.calls[0] as [
      string,
      { tags: Record<string, string> },
    ];
    expect(options.tags.failure).toBe("secret-missing");
  });

  /* 公開される通知に秘密が混ざらないこと。 */
  it("鍵の値は一切載せない", () => {
    reportLedgerAuthFailure({ source: "linkage-status-forward", failure: "key-rejected" });

    const serialized = JSON.stringify(captureMessage.mock.calls);
    expect(serialized).not.toMatch(/secret["']?\s*:\s*["'][^"']{8,}/i);
  });
});

describe("probeLedgerSharedSecret — 人を介さずに鍵の生死を見る", () => {
  const baseUrl = "https://cx.example.test";

  it("鍵が未設定なら not-configured", async () => {
    const fetchImpl = vi.fn();
    const result = await probeLedgerSharedSecret({
      baseUrl,
      secret: undefined,
      fetchImpl: fetchImpl as never,
    });

    expect(result.verdict).toBe("not-configured");
    // 無駄打ちしない
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("401 なら misconfigured（これが 08-30 に見えていなかった状態）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    const result = await probeLedgerSharedSecret({
      baseUrl,
      secret: "s",
      fetchImpl: fetchImpl as never,
    });

    expect(result.verdict).toBe("misconfigured");
  });

  it("200 なら ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await probeLedgerSharedSecret({
      baseUrl,
      secret: "s",
      fetchImpl: fetchImpl as never,
    });

    expect(result.verdict).toBe("ok");
  });

  /* 台帳側の別の不調でこの監視が鳴り続けると読まれなくなる。見ているのは鍵だけ。 */
  it("400 / 500 でも鍵は通っているので ok", async () => {
    for (const status of [400, 404, 500]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status }));
      const result = await probeLedgerSharedSecret({
        baseUrl,
        secret: "s",
        fetchImpl: fetchImpl as never,
      });
      expect(result.verdict).toBe("ok");
    }
  });

  it("届かなければ unknown（正常とは言わない）", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    const result = await probeLedgerSharedSecret({
      baseUrl,
      secret: "s",
      fetchImpl: fetchImpl as never,
    });

    expect(result.verdict).toBe("unknown");
  });

  /* 監視が本番の台帳に行を書くことは絶対にあってはならない。 */
  it("読み取り専用の口を GET でしか叩かない", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await probeLedgerSharedSecret({
      baseUrl,
      secret: "s",
      fetchImpl: fetchImpl as never,
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(url).toContain("/api/identity/linkage-status");
    expect(url).not.toContain("link-liff");
  });
});
