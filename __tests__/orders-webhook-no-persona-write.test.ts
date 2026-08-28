/**
 * 注文 webhook が **persona を書かない** ことを固定する (T-1 / CDP 統合 Stage 0).
 *
 * ## なぜここを固定するのか
 *
 * 同じ注文について、web-app のこの route と cx-agent の
 * `src/lib/preference-pipeline.ts` の **両方が** persona スコアを加算していた。
 * 接続先の Firebase プロジェクトが同じなら二重加算、別なら同じ人のカルテが
 * 2 つに分裂する — どちらが起きているのかを、人が実機に入るまで誰も言えなかった。
 *
 * Stage 0 で web-app 側の書き込みを撤去し、書き手を cx-agent の 1 本に寄せた。
 * ここで固定したいのは「今は書いていない」ではなく **「二度と書き手が 2 本に
 * ならない」** ことである。
 *
 * ## なぜ正規表現の件数固定 (ratchet) ではなくテストなのか
 *
 * 「`persona:` という字面を数えて 0 に固定する」形だと、パターンが対象を
 * 見失った瞬間に 0 件になって**緑のまま**になる。数えられていないことと
 * 書いていないことが区別できない — この仕組みが最も嫌う壊れ方である。
 *
 * よってここでは実際にトランザクションの中身を走らせ、**Firestore に渡された
 * 書き込みペイロードそのもの**を見る。route の内部構造が変わっても、persona を
 * 書けば必ず落ちる。
 *
 * (cx-agent 側は「書き手がちょうど 1 本ある」ことを ratchet `persona-writers`
 *  で固定している。2 リポにまたがる 1 つの数は作れないので、
 *  「cx-agent = 1 本」と「web-app = 0 本」の 2 つで全体の 1 本を担保する。)
 *
 * Shopify 検証 / Firestore / LINE 送出はすべて mock。**実送信はしない**。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const validateWebhookRequestMock = vi.fn();
const checkWebhookIdempotencyMock = vi.fn();
vi.mock("@/lib/shopify/webhooks/verify", () => ({
  validateWebhookRequest: (...args: unknown[]) =>
    validateWebhookRequestMock(...args),
  checkWebhookIdempotency: (...args: unknown[]) =>
    checkWebhookIdempotencyMock(...args),
}));

const getAdminFirestoreMock = vi.fn();
vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: (...args: unknown[]) => getAdminFirestoreMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "server-timestamp" },
  Timestamp: { fromDate: (d: Date) => ({ toDate: () => d }) },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// 例外時にのみ呼ばれる経路。route は戻り値に .catch を繋ぐので Promise を返させる
// (返さないと「本当の失敗理由」がこのモックの TypeError に置き換わって見えなくなる)。
const notifyWebhookExceptionMock = vi.fn(async () => undefined);
vi.mock("@/lib/line/monitoring-alerts", () => ({
  notifyWebhookException: (...args: unknown[]) =>
    notifyWebhookExceptionMock(...(args as [])),
}));

import { POST } from "@/app/api/webhooks/orders/route";

const CUSTOMER_ID = 555000111;

function orderPayload() {
  return {
    id: 9900001,
    order_number: 1234,
    email: "customer@example.test",
    customer: {
      id: CUSTOMER_ID,
      email: "customer@example.test",
      first_name: "太郎",
      last_name: "山田",
    },
    line_items: [
      {
        title: "Tea",
        quantity: 1,
        variant_id: 1,
        product_id: 2,
        price: "3000.00",
      },
    ],
    total_price: "3000.00",
    currency: "JPY",
    created_at: new Date().toISOString(),
    financial_status: "paid",
    fulfillment_status: null,
  };
}

type Write = { kind: "set" | "update"; payload: Record<string, unknown> };

/**
 * トランザクションを **実際に走らせて** 書き込みを記録するスタブ。
 *
 * 既存の orders-webhook-line-notify テストは runTransaction ごとモックするので
 * 中身は 1 行も走らない。ここでは中身こそが検査対象なので走らせる。
 */
function recordingFirestore() {
  const writes: Write[] = [];
  const reads: string[] = [];

  const docRef = {
    _path: "doc",
    collection: () => ({ doc: () => docRef }),
  };

  const tx = {
    get: async (ref: unknown) => {
      reads.push(String((ref as { _path?: string })?._path ?? "unknown"));
      return { exists: false };
    },
    set: (_ref: unknown, payload: Record<string, unknown>) => {
      writes.push({ kind: "set", payload });
    },
    update: (_ref: unknown, payload: Record<string, unknown>) => {
      writes.push({ kind: "update", payload });
    },
  };

  return {
    writes,
    reads,
    db: {
      collection: () => ({ doc: () => docRef }),
      runTransaction: async (
        fn: (t: typeof tx) => Promise<unknown>,
      ): Promise<unknown> => fn(tx),
    },
  };
}

function request(): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

let store: ReturnType<typeof recordingFirestore>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  validateWebhookRequestMock.mockResolvedValue({
    ok: true,
    rawBody: "{}",
    payload: orderPayload(),
    topic: "orders/create",
    webhookId: "wh-no-persona",
  });
  checkWebhookIdempotencyMock.mockResolvedValue({
    alreadyProcessed: false,
    markProcessed: vi.fn(async () => {}),
  });

  store = recordingFirestore();
  getAdminFirestoreMock.mockReturnValue(store.db);
});

describe("注文 webhook は persona を書かない (T-1)", () => {
  it("取り込みは成功する (撤去で壊していないことの前提確認)", async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(store.writes.length, "注文ミラー・行動ログ・ユーザーの 3 書き込み").toBe(3);
  });

  it("どの書き込みペイロードにも persona 項目が無い", async () => {
    await POST(request());

    for (const w of store.writes) {
      expect(
        Object.prototype.hasOwnProperty.call(w.payload, "persona"),
        `persona を書いている: ${JSON.stringify(w.payload)}`,
      ).toBe(false);
    }
  });

  it("persona スコアの語彙 (serenity / explorer / sensory) がどこにも書かれない", async () => {
    await POST(request());

    const serialized = JSON.stringify(store.writes);
    for (const axis of ["serenity", "explorer", "sensory"]) {
      expect(serialized, `persona 軸 "${axis}" を書いている`).not.toContain(axis);
    }
  });

  it("behaviorLog の personaSignal は null (項目ごと落とさない)", async () => {
    await POST(request());

    const behavior = store.writes.find((w) =>
      Object.prototype.hasOwnProperty.call(w.payload, "personaSignal"),
    );
    expect(behavior, "behaviorLog の書き込みが見つからない").toBeDefined();
    // 「項目が無い = 未定義」と「null = 判定していない」を区別できる形に保つ。
    // 落としてしまうと、cx-agent が書いた過去の行と読み分けられなくなる。
    expect(behavior?.payload.personaSignal).toBe(null);
  });

  it("トランザクション内の読み取りは冪等判定の 1 回だけ", async () => {
    await POST(request());

    // 撤去前は「注文件数の集計」と「ユーザー文書」も読んでいた。どちらも persona
    // 加算のためだけの読み取りで、今は誰も結果を使わない。トランザクションの
    // 読み取りは競合検出の対象になるため、使わない読み取りを残すと注文の
    // 取り込みが理由なく再試行で詰まる。
    expect(store.reads.length, `余分な読み取りが残っている: ${store.reads}`).toBe(1);
  });
});
