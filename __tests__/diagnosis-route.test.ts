/**
 * POST /api/diagnosis が守る契約（CDP 統合 Stage 4）。
 *
 * 二重ゲートの **サーバ側** をここで固定する。送り手（ブラウザ）は同意が無ければ
 * 匿名 ID を発行しないが、送り手はブラウザ側の状態にすぎない。通す / 通さないの
 * 最終判断はサーバが持つ（`resolveBehaviorSubject`）。壊れても画面は何も変わらない
 * ので、実際に gateway へ渡った引数を観測して確かめる。
 *
 * あわせて「積めなくても結果は返す」を固定する。記録の可否と、答えた人に結果を
 * 見せることは別の話で、前者の失敗で後者を巻き添えにすると「同意しない人は診断を
 * 使えない」になる。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const resolveIdentityMock = vi.fn();
vi.mock("@/lib/firebase/auth-guard", () => ({
  resolveIdentity: () => resolveIdentityMock(),
}));

vi.mock("@/lib/ratelimit", () => ({
  enforceRateLimit: vi.fn(async () => null),
  limiters: { authedUser: {} },
}));

const sendToEventsGatewayMock = vi.fn(async () => true);
vi.mock("@/lib/cdp/events-gateway-client", () => ({
  sendToEventsGateway: (...args: unknown[]) => sendToEventsGatewayMock(...(args as [])),
}));

let consentCookie: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "cookie_consent" && consentCookie !== null
        ? { name, value: consentCookie }
        : undefined,
  }),
}));

import { POST } from "@/app/api/diagnosis/route";
import { COOKIE_NAME } from "@/lib/auth/cookie-names";

const ANON_ID = "b".repeat(32);

function post(body: unknown): NextRequest {
  return new NextRequest("https://elxea.test/api/diagnosis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendToEventsGatewayMock.mockResolvedValue(true);
  consentCookie = null;
  resolveIdentityMock.mockReturnValue({ authenticated: false });
});

describe("同意の cookie 名がテストと実装でずれていない", () => {
  it("cookie_consent を読む", () => {
    expect(COOKIE_NAME.cookieConsent).toBe("cookie_consent");
  });
});

describe("匿名の来訪者", () => {
  it("同意が無ければ L0 へ 1 件も送らない（結果は返す）", async () => {
    consentCookie = "essential";

    const res = await POST(post({ q1: 1, q2: 1, q3: 1, anonymousId: ANON_ID }));
    const body = await res.json();

    expect(sendToEventsGatewayMock).not.toHaveBeenCalled();
    expect(body.persona).toBe("serenity");
    expect(body.recorded).toBe(false);
    expect(body.reason).toBe("anonymous_without_consent");
  });

  it("同意が無いのは cookie が未設定のときも同じ", async () => {
    consentCookie = null;

    const res = await POST(post({ q1: 1, q2: 1, q3: 1, anonymousId: ANON_ID }));

    expect(sendToEventsGatewayMock).not.toHaveBeenCalled();
    expect((await res.json()).recorded).toBe(false);
  });

  it("同意があれば匿名 ID で 3 件積む", async () => {
    consentCookie = "all";

    const res = await POST(post({ q1: 2, q2: 3, q3: 1, anonymousId: ANON_ID }));
    const body = await res.json();

    expect(sendToEventsGatewayMock).toHaveBeenCalledTimes(1);
    const [events] = sendToEventsGatewayMock.mock.calls[0] as unknown as [
      Array<Record<string, unknown>>,
    ];
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.identifier_kind === "web_anonymous_id")).toBe(true);
    expect(events.every((e) => e.identifier_value === ANON_ID)).toBe(true);
    /* 3 件が 1 回の診断であることを表すので、時刻は 1 度だけ決まる。 */
    expect(new Set(events.map((e) => e.occurred_at)).size).toBe(1);
    expect(body.recorded).toBe(true);
  });

  it("同意があっても匿名 ID が無ければ積まない（誰の出来事か決まらない）", async () => {
    consentCookie = "all";

    const res = await POST(post({ q1: 1, q2: 1, q3: 1 }));

    expect(sendToEventsGatewayMock).not.toHaveBeenCalled();
    expect((await res.json()).reason).toBe("anonymous_id_missing");
  });
});

describe("会員", () => {
  it("Shopify 顧客番号で積む（同意 cookie に依らない）", async () => {
    resolveIdentityMock.mockReturnValue({
      authenticated: true,
      shopifyCustomerId: "900800400001",
      userKey: "900800400001",
    });
    consentCookie = "essential";

    await POST(post({ q1: 3, q2: 2, q3: 3 }));

    const [events] = sendToEventsGatewayMock.mock.calls[0] as unknown as [
      Array<Record<string, unknown>>,
    ];
    expect(events.every((e) => e.identifier_kind === "shopify_customer_id")).toBe(true);
    expect(events.every((e) => e.identifier_value === "900800400001")).toBe(true);
  });

  it("LINE ログインだけの人は line_login_uid で積む", async () => {
    resolveIdentityMock.mockReturnValue({
      authenticated: true,
      shopifyCustomerId: null,
      lineUserId: "U-line-login-sub",
      userKey: "line:U-line-login-sub",
    });

    await POST(post({ q1: 1, q2: 1, q3: 1 }));

    const [events] = sendToEventsGatewayMock.mock.calls[0] as unknown as [
      Array<Record<string, unknown>>,
    ];
    expect(events.every((e) => e.identifier_kind === "line_login_uid")).toBe(true);
  });
});

describe("L0 に届かなくても診断は成立する", () => {
  it("gateway が false を返しても結果は返る", async () => {
    consentCookie = "all";
    sendToEventsGatewayMock.mockResolvedValue(false);

    const res = await POST(post({ q1: 3, q2: 3, q3: 3, anonymousId: ANON_ID }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persona).toBe("sensory");
    expect(body.recorded).toBe(false);
  });
});

describe("形が壊れた答えは受けない", () => {
  it.each([
    { q1: 4, q2: 1, q3: 1 },
    { q1: 1, q2: 5, q3: 1 },
    { q1: 1, q2: 1 },
    { q1: 1, q2: 1, q3: 1, persona: "serenity" },
  ])("%o は 400", async (body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(sendToEventsGatewayMock).not.toHaveBeenCalled();
  });
});
