/**
 * M-2 — 「台帳に行が立った」を受けて合体する唯一の口。
 *
 * ## なぜこの口が要るのか（D-3 の正体）
 *
 * 連携は 4 経路で成立しうるが、**LINE トーク内の Account Link だけは web-app を
 * 一度も通らない**（LINE → cx-agent の webhook で完結する）。だから web-app 側に
 * 合体を始めるきっかけが構造的に存在せず、連携は台帳上成立しているのに、お気に入りは
 * `users/line:<ID>` に取り残されていた。
 *
 * 経路ごとに合図を足していく限り、経路が増えるたびに同じ穴が空く。よって合図を
 * 1 イベントに集約し、書いた側（cx-agent）から通知させる。
 *
 * ## このテストが守るもの
 *
 *   1. **鍵が無ければ素通しにしない** — この口は「この LINE とこの顧客は同一人物だ」と
 *      宣言でき、通れば元の棚を消して荷物を移す。取り返しがつかない
 *   2. 顧客 ID の形（GID / 数値）を正規化する — 揺れたまま合体すると棚が分裂する
 *   3. 合体できなかったら 200 を返さない — 無音だと D-3 が別の形で復活する
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const applyLinkageEstablished = vi.fn();
vi.mock("@/lib/auth/identity-link", () => ({ applyLinkageEstablished }));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const SECRET = "test-linkage-event-secret";
const SAVED = { LINKAGE_EVENT_SECRET: process.env.LINKAGE_EVENT_SECRET };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LINKAGE_EVENT_SECRET = SECRET;
  applyLinkageEstablished.mockResolvedValue({
    outcome: "merged",
    merge: { totals: { copied: 3 }, retained: 0 },
  });
});

afterEach(() => {
  if (SAVED.LINKAGE_EVENT_SECRET === undefined) delete process.env.LINKAGE_EVENT_SECRET;
  else process.env.LINKAGE_EVENT_SECRET = SAVED.LINKAGE_EVENT_SECRET;
  vi.resetModules();
});

function eventRequest(
  body: unknown,
  { auth = `Bearer ${SECRET}` }: { auth?: string | null } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers.authorization = auth;
  return new NextRequest("https://elxea.com/api/internal/linkage-established", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function post(req: NextRequest) {
  const { POST } = await import(
    "@/app/api/internal/linkage-established/route"
  );
  return POST(req);
}

const VALID = {
  line_user_id: "U0123456789abcdef0123456789abcdef",
  shopify_customer_id: "7654321",
  source: "account_link",
};

describe("POST /api/internal/linkage-established", () => {
  it("正しい鍵で来たら合体を実行して 200", async () => {
    const res = await post(eventRequest(VALID));
    expect(res.status).toBe(200);
    expect(applyLinkageEstablished).toHaveBeenCalledWith({
      lineUserId: VALID.line_user_id,
      shopifyCustomerId: "7654321",
      source: "linkage-event",
    });
  });

  /* ── 鍵まわり ── */
  it("鍵が違えば 401（合体しない）", async () => {
    const res = await post(eventRequest(VALID, { auth: "Bearer wrong-secret" }));
    expect(res.status).toBe(401);
    expect(applyLinkageEstablished).not.toHaveBeenCalled();
  });

  it("Authorization が無ければ 401", async () => {
    const res = await post(eventRequest(VALID, { auth: null }));
    expect(res.status).toBe(401);
    expect(applyLinkageEstablished).not.toHaveBeenCalled();
  });

  it("Bearer 以外の形式は 401", async () => {
    const res = await post(eventRequest(VALID, { auth: SECRET }));
    expect(res.status).toBe(401);
  });

  /* 鍵が無い状態で素通しにすると、**誰でも他人の棚へデータを移せる**口になる。
     合体は元を消す操作なので、間違えても元に戻せない。 */
  it("鍵が未設定なら 503 で fail-closed（素通しにしない）", async () => {
    delete process.env.LINKAGE_EVENT_SECRET;
    const res = await post(eventRequest(VALID));
    expect(res.status).toBe(503);
    expect(applyLinkageEstablished).not.toHaveBeenCalled();
  });

  /* ── 入力の正規化 ── */
  it("顧客 ID が GID で来ても数値へ正規化する（棚を分裂させない）", async () => {
    await post(
      eventRequest({ ...VALID, shopify_customer_id: "gid://shopify/Customer/7654321" }),
    );
    expect(applyLinkageEstablished).toHaveBeenCalledWith(
      expect.objectContaining({ shopifyCustomerId: "7654321" }),
    );
  });

  it("識別子が欠けていれば 400（合体しない）", async () => {
    for (const body of [
      { ...VALID, line_user_id: "" },
      { ...VALID, shopify_customer_id: "" },
      { source: "account_link" },
    ]) {
      const res = await post(eventRequest(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(applyLinkageEstablished).not.toHaveBeenCalled();
  });

  it("JSON が壊れていれば 400", async () => {
    const req = new NextRequest(
      "https://elxea.com/api/internal/linkage-established",
      {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
        body: "not json",
      },
    );
    const res = await post(req);
    expect(res.status).toBe(400);
  });

  /* ── 失敗を握り潰さない ── */
  it("合体できなかったら 200 を返さない（cx-agent に再送させる）", async () => {
    applyLinkageEstablished.mockResolvedValue({
      outcome: "merge-failed",
      merge: null,
    });
    const res = await post(eventRequest(VALID));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, outcome: "merge-failed" });
  });
});
