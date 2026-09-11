/**
 * M-5 / Issue A — 「消しました」と言えるのは、本当に消えたときだけ。
 *
 * ## 何を守るテストか
 *
 * cx-agent の `POST /api/erase` は **3 分岐**で応答する。
 *
 * | 応答 | 意味 |
 * |---|---|
 * | `200 {status:"erased"}` | 消し終わった |
 * | `202 {status:"in_progress", continue_required:true}` | **途中まで**しか消していない |
 * | `500` | 消し残しがある |
 *
 * 202 は **2xx だが完了ではない**。素朴に `res.ok` で判定すると、ここが静かに
 * 「成功」になって消し残しが残る — しかも消去は「消えた」と答えた後なので、
 * 誰も気付かない。この 1 点がこのテストの中心。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { eraseInCxAgent } from "@/lib/erase/cx-agent";

const SAVED = { ERASE_API_SECRET: process.env.ERASE_API_SECRET };

beforeEach(() => {
  process.env.ERASE_API_SECRET = "test-erase-secret";
});

afterEach(() => {
  if (SAVED.ERASE_API_SECRET === undefined) delete process.env.ERASE_API_SECRET;
  else process.env.ERASE_API_SECRET = SAVED.ERASE_API_SECRET;
  vi.restoreAllMocks();
});

/** 決まった応答を順に返す fetch。呼ばれた回数と中身を検査できる。 */
function fetchReturning(...responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const SUBJECT = { kind: "shopify", id: "7654321" } as const;

describe("eraseInCxAgent", () => {
  it("200 erased なら成功（1 回で終わる）", async () => {
    const { impl, calls } = fetchReturning({ status: 200, body: { status: "erased" } });
    const r = await eraseInCxAgent(SUBJECT, { fetchImpl: impl });
    expect(r.ok).toBe(true);
    expect(r.ok && r.attempts).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("契約どおりの body と別鍵の Bearer を送る", async () => {
    const { impl, calls } = fetchReturning({ status: 200, body: { status: "erased" } });
    await eraseInCxAgent(SUBJECT, { fetchImpl: impl });

    const { url, init } = calls[0];
    expect(url.endsWith("/api/erase")).toBe(true);
    expect(init.method).toBe("POST");
    /* SYNC_API_SECRET とは別鍵。取り違えると 401 になる。 */
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-erase-secret",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      subject_kind: "shopify",
      subject_id: "7654321",
    });
  });

  /* ── ここが本丸 ── */
  it("202 continue_required は成功にせず、消し終わるまで呼び直す", async () => {
    const { impl, calls } = fetchReturning(
      { status: 202, body: { status: "in_progress", continue_required: true } },
      { status: 202, body: { status: "in_progress", continue_required: true } },
      { status: 200, body: { status: "erased" } },
    );
    const r = await eraseInCxAgent(SUBJECT, { fetchImpl: impl });
    expect(r.ok).toBe(true);
    expect(r.ok && r.attempts).toBe(3);
    expect(calls).toHaveLength(3);
    // 続きも同じ body で呼ぶ（cx-agent 側が「同じ subject で再送」を要求している）
    expect(JSON.parse(String(calls[2].init.body))).toEqual(
      JSON.parse(String(calls[0].init.body)),
    );
  });

  it("202 が続いたまま上限に達したら失敗（成功に丸めない・再送はさせる）", async () => {
    const { impl, calls } = fetchReturning({
      status: 202,
      body: { status: "in_progress", continue_required: true },
    });
    const r = await eraseInCxAgent(SUBJECT, { fetchImpl: impl, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("budget-exhausted");
    expect(!r.ok && r.retryable).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("時間予算を超えたら打ち切る（webhook の応答を落とさない）", async () => {
    const { impl } = fetchReturning({
      status: 202,
      body: { status: "in_progress", continue_required: true },
    });
    let t = 0;
    const r = await eraseInCxAgent(SUBJECT, {
      fetchImpl: impl,
      maxAttempts: 50,
      totalBudgetMs: 100,
      now: () => (t += 60), // 1 回目の後に予算超過する刻み
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("budget-exhausted");
    expect(!r.ok && r.retryable).toBe(true);
  });

  it("500 incomplete（消し残し）は失敗", async () => {
    const { impl } = fetchReturning({
      status: 500,
      body: { status: "incomplete", residue: { remaining: 3 } },
    });
    const r = await eraseInCxAgent(SUBJECT, { fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("incomplete");
    expect(!r.ok && r.retryable).toBe(true);
  });

  /* 「鍵が無い / 鍵が違う」は再送しても直らない。他の失敗と混ぜると、
     直らない原因で Shopify の再送が延々と走る。 */
  it("鍵が無ければ失敗（何もしなくてよい、に倒さない）", async () => {
    delete process.env.ERASE_API_SECRET;
    const { impl, calls } = fetchReturning({ status: 200, body: { status: "erased" } });
    const r = await eraseInCxAgent(SUBJECT, { fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("not-configured");
    expect(!r.ok && r.retryable).toBe(false);
    expect(calls).toHaveLength(0); // 呼びにすら行かない
  });

  it("401 は再送で直らない失敗として返す", async () => {
    const { impl } = fetchReturning({ status: 401, body: { error: "Unauthorized" } });
    const r = await eraseInCxAgent(SUBJECT, { fetchImpl: impl });
    expect(!r.ok && r.reason).toBe("unauthorized");
    expect(!r.ok && r.retryable).toBe(false);
  });

  it("届かないときは失敗（throw しない）", async () => {
    const impl = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    const r = await eraseInCxAgent(SUBJECT, { fetchImpl: impl });
    expect(!r.ok && r.reason).toBe("unreachable");
    expect(!r.ok && r.retryable).toBe(true);
  });

  /* 契約と違う応答を「たぶん成功」と読むのが、この一連の欠陥の作られ方だった。 */
  it("200 でも status が erased でなければ成功にしない", async () => {
    const { impl } = fetchReturning({ status: 200, body: { status: "queued" } });
    const r = await eraseInCxAgent(SUBJECT, { fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("bad-response");
  });

  it("202 でも continue_required が無ければ成功にも継続にもしない", async () => {
    const { impl, calls } = fetchReturning({ status: 202, body: { status: "in_progress" } });
    const r = await eraseInCxAgent(SUBJECT, { fetchImpl: impl });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("bad-response");
    expect(calls).toHaveLength(1);
  });

  it("line 主体でも同じ契約で呼べる", async () => {
    const { impl, calls } = fetchReturning({ status: 200, body: { status: "erased" } });
    const r = await eraseInCxAgent({ kind: "line", id: "Uabc" }, { fetchImpl: impl });
    expect(r.ok).toBe(true);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      subject_kind: "line",
      subject_id: "Uabc",
    });
  });
});
