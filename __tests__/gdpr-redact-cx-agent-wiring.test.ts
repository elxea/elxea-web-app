/**
 * M-5 / Issue A — **配線そのもの**を固定する。
 *
 * ## なぜ単体テストだけでは足りないのか
 *
 * 今回直している欠陥は「消去の実装が間違っていた」ではない。cx-agent の
 * `POST /api/erase` は正しく実装されていて、設計意図もコードに書いてあった。
 * **web-app から一度も呼ばれていなかった**だけである。
 *
 * つまり `lib/erase/cx-agent.ts` をどれだけ丁寧にテストしても、それが
 * `customers/redact` から呼ばれていなければ本番では何も変わらない。これは
 * 再設計 §2-4 が「中心機能が未実装のまま 25 本超の PR が全緑で通過し続けた」
 * と呼んだ失敗モードそのもの。よって **route が実際に呼ぶこと**を別に固定する。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const eraseInCxAgent = vi.fn();
vi.mock("@/lib/erase/cx-agent", () => ({ eraseInCxAgent }));

/** webhook の署名検証は素通しにする（このテストの関心事ではない）。 */
vi.mock("@/lib/shopify/webhooks/verify", () => ({
  validateWebhookRequest: vi.fn(async () => ({
    ok: true,
    topic: "customers/redact",
    payload: { customer: { id: 7654321 }, shop_domain: "elxea.myshopify.com" },
  })),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

/* Firestore のふるまいを最小限で再現する。ここで見たいのは「削除が呼ばれたか」
   「冪等ログが書かれたか」の 2 点だけ。 */
const deletedDocs: string[] = [];
const writtenWebhookLogs: string[] = [];

const makeDb = () => ({
  collection: (path: string) => {
    if (path === "_webhookLogs") {
      return {
        doc: (id: string) => ({
          get: async () => ({ exists: false }),
          set: async () => {
            writtenWebhookLogs.push(id);
          },
        }),
      };
    }
    return { get: async () => ({ empty: true, size: 0, docs: [] }) };
  },
  batch: () => ({ delete: () => {}, commit: async () => {} }),
  doc: (path: string) => ({
    delete: async () => {
      deletedDocs.push(path);
    },
  }),
});

vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => makeDb(),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "ts" },
  Timestamp: { fromDate: (d: Date) => d },
}));

function redactRequest() {
  return new NextRequest("https://elxea.com/api/webhooks/gdpr/customers-redact", {
    method: "POST",
    headers: { "x-shopify-webhook-id": "wh_test_1" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  deletedDocs.length = 0;
  writtenWebhookLogs.length = 0;
});

afterEach(() => {
  vi.resetModules();
});

describe("customers/redact は cx-agent の消去を必ず通る", () => {
  it("消去に成功したときだけ 200 を返し、Firestore も消す", async () => {
    eraseInCxAgent.mockResolvedValue({ ok: true, attempts: 1 });

    const { POST } = await import(
      "@/app/api/webhooks/gdpr/customers-redact/route"
    );
    const res = await POST(redactRequest());

    expect(res.status).toBe(200);
    /* 「呼ばれたこと」と「誰を消すよう頼んだか」の両方を見る。主体を取り違えると
       他人のデータを消すことになるので、ここは形だけの確認では足りない。 */
    expect(eraseInCxAgent).toHaveBeenCalledWith({ kind: "shopify", id: "7654321" });
    expect(deletedDocs).toContain("users/7654321");
    expect(writtenWebhookLogs).toContain("wh_test_1");
  });

  /* ── ここが本丸 ── */
  it("cx-agent が消し残しを報告したら 200 を返さない（G10 成功偽装の禁止）", async () => {
    eraseInCxAgent.mockResolvedValue({
      ok: false,
      reason: "incomplete",
      detail: "residue remains",
      attempts: 1,
      retryable: true,
    });

    const { POST } = await import(
      "@/app/api/webhooks/gdpr/customers-redact/route"
    );
    const res = await POST(redactRequest());

    expect(res.status).toBe(503);
    /* 冪等ログを書いてはいけない。書くと再送が「処理済み」で弾かれ、
       **消えていないまま二度と消えなくなる**。 */
    expect(writtenWebhookLogs).toHaveLength(0);
  });

  it("cx-agent が失敗したら Firestore は消さない（中途半端な状態を作らない）", async () => {
    eraseInCxAgent.mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "fetch failed",
      attempts: 1,
      retryable: true,
    });

    const { POST } = await import(
      "@/app/api/webhooks/gdpr/customers-redact/route"
    );
    await POST(redactRequest());

    expect(deletedDocs).toHaveLength(0);
  });

  /* 再送で直らない失敗 (鍵が無い / 鍵が違う) は 503 で急かさない。
     Shopify に無駄な再送を延々とさせても直らないため。 */
  it("再送で直らない失敗は 500（503 で再送を促さない）", async () => {
    eraseInCxAgent.mockResolvedValue({
      ok: false,
      reason: "not-configured",
      detail: "ERASE_API_SECRET is not set",
      attempts: 0,
      retryable: false,
    });

    const { POST } = await import(
      "@/app/api/webhooks/gdpr/customers-redact/route"
    );
    const res = await POST(redactRequest());

    expect(res.status).toBe(500);
    expect(writtenWebhookLogs).toHaveLength(0);
  });
});
