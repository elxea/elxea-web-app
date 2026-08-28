/**
 * GDPR 削除が **500 件を超えても最後まで消える** ことを固定する (#6 / CDP Stage 0)。
 *
 * ## なぜこのテストが要るのか — 直した欠陥を、直す前のテストは緑にしていた
 *
 * 以前の実装はサブコレクションの全ドキュメントを 1 つの `db.batch()` に積んで
 * 1 回だけ commit していた。Firestore の batch 上限は 500 write なので、
 * `behaviorLog` が 500 件を超える人の削除は **必ず** 失敗する。
 *
 * この壊れ方は**当たる人が偏る**。落ちるのは LINE と EC を長く使い、最も多くの
 * 個人データが溜まっている人だけ。ライトユーザーの削除要求は通り、ヘビー
 * ユーザーの削除要求だけが弾かれる。GDPR 上いちばん実害が大きい側だけが
 * 消えない、静かで偏った失敗だった。
 *
 * **そしてこれを既存のテストは捕まえられなかった。** 既存の
 * `gdpr-redact-cx-agent-wiring.test.ts` の Firestore スタブは全コレクションを
 * 空 (`{ empty: true, size: 0, docs: [] }`) で返す。空なら batch は 1 つも
 * 作られないので、1 バッチだろうが 100 バッチだろうがテストの結果は変わらない。
 * 「関数を呼んだか」は見ていたが「500 件を超えたときどうなるか」は一度も
 * 通っていなかった — 欠陥が生き延びた場所そのものである。
 *
 * よってここでは **境界そのもの** を入力にする: 500 ちょうど / 501 / 1200。
 * commit が何回呼ばれ、各回に何件積まれたかを実測する。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

import { USER_SUBCOLLECTIONS } from "@/lib/firebase/collections";

const eraseInCxAgent = vi.fn();
vi.mock("@/lib/erase/cx-agent", () => ({ eraseInCxAgent }));

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

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "ts" },
  Timestamp: { fromDate: (d: Date) => d },
}));

/** どのサブコレクションに何件入っているか (テストごとに差し替える)。 */
let docCounts: Record<string, number> = {};

/** commit ごとの delete 件数。長さ = commit 回数。 */
let commitSizes: number[] = [];
/** 実際に delete された doc の参照パス (重複・取りこぼしを見る)。 */
let deletedRefs: string[] = [];
/** 走査されたコレクションのパス。 */
let scannedCollections: string[] = [];
/** commit が「順番に」呼ばれたか (未解決の commit が同時に 2 つ以上無いか)。 */
let maxConcurrentCommits = 0;
let inFlightCommits = 0;

function makeDb() {
  return {
    collection: (path: string) => {
      if (path === "_webhookLogs") {
        return {
          doc: () => ({
            get: async () => ({ exists: false }),
            set: async () => {},
          }),
        };
      }
      scannedCollections.push(path);
      const n = docCounts[path] ?? 0;
      const docs = Array.from({ length: n }, (_, i) => ({
        ref: { path: `${path}/doc-${i}` },
      }));
      return { get: async () => ({ empty: n === 0, size: n, docs }) };
    },
    batch: () => {
      const staged: string[] = [];
      return {
        delete: (ref: { path: string }) => {
          staged.push(ref.path);
        },
        commit: async () => {
          inFlightCommits += 1;
          maxConcurrentCommits = Math.max(maxConcurrentCommits, inFlightCommits);
          // 実際の I/O のように 1 tick 待たせる (順次かどうかを観測するため)。
          await Promise.resolve();
          commitSizes.push(staged.length);
          deletedRefs.push(...staged);
          inFlightCommits -= 1;
        },
      };
    },
    doc: () => ({ delete: async () => {} }),
  };
}

vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => makeDb(),
}));

const { POST } = await import("@/app/api/webhooks/gdpr/customers-redact/route");

function request(): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/gdpr/customers-redact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

/** 対象顧客の behaviorLog にだけ n 件入っている状態を作る。 */
function seedBehaviorLog(n: number) {
  const path = USER_SUBCOLLECTIONS.map(
    (sub) => `users/7654321/${sub}`,
  ).find((p) => p.endsWith("behaviorLog"));
  if (!path) throw new Error("behaviorLog が USER_SUBCOLLECTIONS に無い");
  docCounts = { [path]: n };
  return path;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  docCounts = {};
  commitSizes = [];
  deletedRefs = [];
  scannedCollections = [];
  maxConcurrentCommits = 0;
  inFlightCommits = 0;
  eraseInCxAgent.mockResolvedValue({ ok: true, residue: null });
});

describe("GDPR 削除の 500 件境界 (#6)", () => {
  it("500 件ちょうどは 1 回の commit で消える", async () => {
    seedBehaviorLog(500);
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(commitSizes).toEqual([500]);
    expect(deletedRefs.length).toBe(500);
  });

  it("501 件は 2 回に分かれ、1 件も取りこぼさない (直す前はここで落ちていた)", async () => {
    seedBehaviorLog(501);
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(commitSizes, "500 + 1 に分割される").toEqual([500, 1]);
    expect(deletedRefs.length).toBe(501);
    expect(new Set(deletedRefs).size, "同じ doc を 2 回消していない").toBe(501);
  });

  it("1200 件は 500/500/200 に分かれ、全件消える", async () => {
    const path = seedBehaviorLog(1200);
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(commitSizes).toEqual([500, 500, 200]);
    expect(deletedRefs.length).toBe(1200);
    // 端の 2 件を名指しで確認する (件数だけ合っていて中身がずれる形を弾く)。
    expect(deletedRefs).toContain(`${path}/doc-0`);
    expect(deletedRefs).toContain(`${path}/doc-1199`);
  });

  it("commit は順番に走る (同時に 2 つ以上投げない)", async () => {
    seedBehaviorLog(1200);
    await POST(request());

    // 並列に投げると「どこまで消えたか」が単調に進まず、途中で落ちたときに
    // 再送で続きから進める保証が崩れる。
    expect(maxConcurrentCommits, "commit が並列に投げられている").toBe(1);
  });

  it("消す対象は USER_SUBCOLLECTIONS 由来 (ハードコードした名前ではない)", async () => {
    seedBehaviorLog(1);
    await POST(request());

    for (const sub of USER_SUBCOLLECTIONS) {
      expect(
        scannedCollections,
        `台帳にある ${sub} が走査されていない = 消し残しになる`,
      ).toContain(`users/7654321/${sub}`);
    }
    // 台帳に無いものを勝手に消しにいっていないこと。
    const allowed = new Set(
      USER_SUBCOLLECTIONS.map((sub) => `users/7654321/${sub}`),
    );
    for (const path of scannedCollections) {
      expect(allowed.has(path), `台帳に無い ${path} を消そうとしている`).toBe(true);
    }
  });

  it("空のサブコレクションでは commit を 1 回も呼ばない", async () => {
    docCounts = {};
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(commitSizes).toEqual([]);
  });
});
