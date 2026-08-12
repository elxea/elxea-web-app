/**
 * Tests for `lib/shopify/next-billing-date.ts`.
 *
 * この層が守るべき契約 (壊れると売上が止まる / 二重課金する):
 *
 *   1. `nextBillingDate` は**算術で作らない**。「UNBILLED かつ skipped でない
 *      cycleIndex 最小の cycle の billingAttemptExpectedDate」を Shopify から導出する。
 *      → 何回走らせても同じ値になり、二重前進が構造的に起きない
 *   2. **差分時のみ書く** (ガード 1)。導出値 == 現在値なら mutation を投げない
 *   3. **前向き専用** (ガード 3)。導出値 < 現在値なら書かず `blocked_backward`
 *   4. **飛び幅トリップワイヤ** (ガード 4)。1 周期 x 1.5 を超える前進は Sentry error
 *      を上げるが**書き込みは止めない** (止めると「無音で前進しない」現状の再生産)
 *   5. **競合耐性** (ガード 5)。書く直前に read-then-compare し、他方が既に書いて
 *      いれば `noop` に落ちる
 *   6. UNBILLED が無い / 日時が読めない / 窓を使い切った、のいずれも**無音にしない**
 *
 * ガード 2 (pending では前進させない) は呼び出し側 (cron / webhook) の責務だが、
 * 導出モデル自体が二重の安全網になっていることを "実データ" のケースで固定する:
 * 一度も課金が通っていない契約は cycle 1 が UNBILLED のままで、その
 * billingAttemptExpectedDate は契約の nextBillingDate と一致する → `noop`。
 *
 * fetch はスタブして「Shopify の状態を持つ小さな偽ストア」に差し替える。外部送信はしない。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/nextjs";

// admin-client は module load 時に env を定数へ取り込むため、import より前に置く。
vi.hoisted(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "elxea-test.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "admin-api-token-for-tests";
});

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import type { SubscriptionBillingCycle } from "@/lib/shopify/admin-types";
import {
  BILLING_CYCLE_MAX_WINDOWS,
  JUMP_TRIPWIRE_PERIOD_MULTIPLE,
  advanceNextBillingDate,
  decideNextBillingDate,
  getEarliestUnbilledCycle,
  selectEarliestUnbilledCycle,
} from "@/lib/shopify/next-billing-date";
import {
  BILLING_CYCLE_INDEX_MAX_SPAN,
  BILLING_CYCLE_INDEX_WINDOW,
  getBillingCycles,
} from "@/lib/shopify/subscription-admin";

const CONTRACT_GID = "gid://shopify/SubscriptionContract/28008382622";

// ─── fixtures ────────────────────────────────────────────────────────

/**
 * cycle fixture。`billingAttemptExpectedDate` は実測に合わせて `cycleEndAt` と同値。
 */
function cycle(
  cycleIndex: number,
  overrides: Partial<SubscriptionBillingCycle> = {}
): SubscriptionBillingCycle {
  const month = String(cycleIndex + 8).padStart(2, "0");
  const end = `2026-${month}-12T04:00:00Z`;
  const prevMonth = String(cycleIndex + 7).padStart(2, "0");
  return {
    cycleIndex,
    status: "UNBILLED",
    skipped: false,
    billingAttemptExpectedDate: end,
    cycleStartAt: `2026-${prevMonth}-12T04:00:01Z`,
    cycleEndAt: end,
    ...overrides,
  };
}

/**
 * 本番契約 28008382622 の実測値 (2026-08-12 / API 2026-07)。
 * cycle 1 が課金済み・cycle 2 が未課金で、導出値は cycle 2 の 2026-10-12T04:00Z。
 */
const REAL_NEXT_BILLING_DATE = "2026-08-12T05:51:24Z";
const REAL_CYCLES: SubscriptionBillingCycle[] = [
  {
    cycleIndex: 1,
    status: "BILLED",
    skipped: false,
    billingAttemptExpectedDate: "2026-09-12T04:00:00Z",
    cycleStartAt: "2026-08-12T04:44:45Z",
    cycleEndAt: "2026-09-12T04:00:00Z",
  },
  {
    cycleIndex: 2,
    status: "UNBILLED",
    skipped: false,
    billingAttemptExpectedDate: "2026-10-12T04:00:00Z",
    cycleStartAt: "2026-09-12T04:00:01Z",
    cycleEndAt: "2026-10-12T04:00:00Z",
  },
  {
    cycleIndex: 3,
    status: "UNBILLED",
    skipped: false,
    billingAttemptExpectedDate: "2026-11-12T04:00:00Z",
    cycleStartAt: "2026-10-12T04:00:01Z",
    cycleEndAt: "2026-11-12T04:00:00Z",
  },
];
const REAL_DERIVED = "2026-10-12T04:00:00Z";

// ─── fake Shopify ────────────────────────────────────────────────────

type FakeStore = {
  nextBillingDate: string | null;
  cycles: SubscriptionBillingCycle[];
  /** mutation に渡った引数の記録。 */
  writes: { contractId: string; date: string }[];
  /** nextBillingDate を読んだ回数。 */
  reads: number;
  /** nextBillingDate を返す直前に呼ばれる。並行書き込みの再現に使う。 */
  onRead?: (store: FakeStore) => void;
  /** cycles クエリに渡った index 範囲の記録。 */
  ranges: { startIndex: number; endIndex: number }[];
  /** true なら mutation が userErrors を返す。 */
  mutationUserError?: string;
};

let fetchMock: ReturnType<typeof vi.fn>;
let store: FakeStore;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeStore(init: Partial<FakeStore> = {}): FakeStore {
  return {
    nextBillingDate: REAL_NEXT_BILLING_DATE,
    cycles: REAL_CYCLES,
    writes: [],
    reads: 0,
    ranges: [],
    ...init,
  };
}

/** `store` を Shopify Admin API に見せる fetch スタブ。 */
function stubShopify(): void {
  fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
    const body = JSON.parse((init as RequestInit).body as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    const { query, variables } = body;

    if (query.includes("query SubscriptionContractNextBillingDate")) {
      store.reads += 1;
      store.onRead?.(store);
      return jsonResponse({
        data: {
          subscriptionContract: {
            id: CONTRACT_GID,
            status: "ACTIVE",
            nextBillingDate: store.nextBillingDate,
          },
        },
      });
    }

    if (query.includes("query SubscriptionBillingCycles")) {
      const range = variables.billingCyclesIndexRangeSelector as {
        startIndex: number;
        endIndex: number;
      };
      expect(
        range,
        "subscriptionBillingCycles は selector 必須 (省略すると INVALID_FIELD_ARGUMENTS)"
      ).toBeDefined();
      store.ranges.push({ ...range });
      const nodes = store.cycles
        .filter(
          (c) =>
            c.cycleIndex >= range.startIndex && c.cycleIndex <= range.endIndex
        )
        .sort((a, b) => a.cycleIndex - b.cycleIndex);
      return jsonResponse({
        data: {
          subscriptionBillingCycles: {
            edges: nodes.map((node, i) => ({ node, cursor: `c${i}` })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    }

    if (query.includes("mutation SubscriptionContractSetNextBillingDate")) {
      if (store.mutationUserError) {
        return jsonResponse({
          data: {
            subscriptionContractSetNextBillingDate: {
              contract: null,
              userErrors: [
                { field: ["date"], message: store.mutationUserError },
              ],
            },
          },
        });
      }
      const date = variables.date as string;
      store.writes.push({ contractId: variables.contractId as string, date });
      store.nextBillingDate = date;
      return jsonResponse({
        data: {
          subscriptionContractSetNextBillingDate: {
            contract: { id: CONTRACT_GID, nextBillingDate: date },
            userErrors: [],
          },
        },
      });
    }

    throw new Error(`unexpected query in test stub: ${query.slice(0, 80)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** テストでは待たない (throttle 時の指数バックオフを無効化)。 */
const NO_WAIT = { pagination: { throttleDelayMs: 0 } } as const;

beforeEach(() => {
  store = makeStore();
  stubShopify();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.mocked(Sentry.captureException).mockClear();
});

// ─── 導出 (純関数) ───────────────────────────────────────────────────

describe("selectEarliestUnbilledCycle", () => {
  it("cycleIndex 最小の UNBILLED を選ぶ", () => {
    const picked = selectEarliestUnbilledCycle([
      cycle(3),
      cycle(1, { status: "BILLED" }),
      cycle(2),
    ]);
    expect(picked?.cycleIndex).toBe(2);
  });

  it("入力の並び順に依存しない (sortKey 変更で静かに壊れない)", () => {
    const cycles = [cycle(5), cycle(2), cycle(9)];
    expect(selectEarliestUnbilledCycle(cycles)?.cycleIndex).toBe(2);
    expect(
      selectEarliestUnbilledCycle([...cycles].reverse())?.cycleIndex
    ).toBe(2);
  });

  it("skipped=true は除外する (スキップ分は課金対象外)", () => {
    const picked = selectEarliestUnbilledCycle([
      cycle(1, { skipped: true }),
      cycle(2, { skipped: true }),
      cycle(3),
    ]);
    expect(picked?.cycleIndex).toBe(3);
  });

  it("BILLED は除外する", () => {
    const picked = selectEarliestUnbilledCycle([
      cycle(1, { status: "BILLED" }),
      cycle(2, { status: "BILLED" }),
      cycle(3),
    ]);
    expect(picked?.cycleIndex).toBe(3);
  });

  it("該当が無ければ null", () => {
    expect(
      selectEarliestUnbilledCycle([
        cycle(1, { status: "BILLED" }),
        cycle(2, { skipped: true }),
      ])
    ).toBeNull();
    expect(selectEarliestUnbilledCycle([])).toBeNull();
  });
});

describe("decideNextBillingDate", () => {
  it("実データの復旧ケース: cycle 2 の expected date へ前進する", () => {
    const result = decideNextBillingDate({
      cycles: REAL_CYCLES,
      currentNextBillingDate: REAL_NEXT_BILLING_DATE,
    });
    expect(result.action).toBe("advanced");
    expect(result.from).toBe(REAL_NEXT_BILLING_DATE);
    expect(result.to).toBe(REAL_DERIVED);
    expect(result.cycleIndex).toBe(2);
  });

  it("導出値 == 現在値なら noop (ガード 1)", () => {
    const result = decideNextBillingDate({
      cycles: [cycle(2)],
      currentNextBillingDate: "2026-10-12T04:00:00Z",
    });
    expect(result.action).toBe("noop");
    expect(result.to).toBe("2026-10-12T04:00:00Z");
  });

  it("表記が違っても同時刻なら noop (文字列比較にしない)", () => {
    const result = decideNextBillingDate({
      cycles: [cycle(2)],
      // 2026-10-12T04:00:00Z と同時刻の +09:00 表記。
      currentNextBillingDate: "2026-10-12T13:00:00+09:00",
    });
    expect(result.action).toBe("noop");
  });

  it("導出値 < 現在値なら blocked_backward (ガード 3)", () => {
    const result = decideNextBillingDate({
      cycles: [cycle(2)],
      currentNextBillingDate: "2027-01-01T00:00:00Z",
    });
    expect(result.action).toBe("blocked_backward");
    expect(result.to).toBe("2026-10-12T04:00:00Z");
    expect(result.reason).toContain("巻き戻り");
  });

  it("UNBILLED cycle が無ければ no_unbilled_cycle で無変更", () => {
    const result = decideNextBillingDate({
      cycles: [cycle(1, { status: "BILLED" }), cycle(2, { skipped: true })],
      currentNextBillingDate: REAL_NEXT_BILLING_DATE,
    });
    expect(result.action).toBe("no_unbilled_cycle");
    expect(result.from).toBe(REAL_NEXT_BILLING_DATE);
    expect(result.to).toBeNull();
  });

  it("導出元の日時が読めなければ failed (推測で書かない)", () => {
    const result = decideNextBillingDate({
      cycles: [cycle(2, { billingAttemptExpectedDate: "not-a-date" })],
      currentNextBillingDate: REAL_NEXT_BILLING_DATE,
    });
    expect(result.action).toBe("failed");
  });

  it("現在値が読めなければ failed (前向き判定ができない)", () => {
    const result = decideNextBillingDate({
      cycles: [cycle(2)],
      currentNextBillingDate: "garbage",
    });
    expect(result.action).toBe("failed");
    expect(result.to).toBe("2026-10-12T04:00:00Z");
  });

  it("現在値が null なら導出値で初期化する", () => {
    const result = decideNextBillingDate({
      cycles: [cycle(2)],
      currentNextBillingDate: null,
    });
    expect(result.action).toBe("advanced");
    expect(result.from).toBeNull();
    expect(result.to).toBe("2026-10-12T04:00:00Z");
    expect(result.jumpExceeded).toBe(false);
  });

  it("1 周期ぶんの前進ではトリップワイヤは鳴らない", () => {
    // cycle 2 = [2026-09-12, 2026-10-12]。現在値を cycle の開始に置くと前進は 1 周期。
    const result = decideNextBillingDate({
      cycles: [cycle(2)],
      currentNextBillingDate: "2026-09-12T04:00:01Z",
    });
    expect(result.action).toBe("advanced");
    expect(result.jumpExceeded).toBe(false);
  });

  it("1 周期 x マージンを超える前進ではトリップワイヤが立つ", () => {
    const target = cycle(2);
    const periodMs =
      new Date(target.cycleEndAt).getTime() -
      new Date(target.cycleStartAt).getTime();
    // 「1 周期 x 係数」より確実に大きい前進になる現在値を作る。
    const currentMs =
      new Date(target.billingAttemptExpectedDate).getTime() -
      Math.ceil(periodMs * JUMP_TRIPWIRE_PERIOD_MULTIPLE) -
      1000;
    const result = decideNextBillingDate({
      cycles: [target],
      currentNextBillingDate: new Date(currentMs).toISOString(),
    });
    expect(result.action).toBe("advanced");
    expect(result.jumpExceeded).toBe(true);
  });

  it("復旧ケースは 2 周期ぶんの飛びなのでトリップワイヤが立つ (書き込みは行う)", () => {
    const result = decideNextBillingDate({
      cycles: REAL_CYCLES,
      currentNextBillingDate: REAL_NEXT_BILLING_DATE,
    });
    expect(result.action).toBe("advanced");
    expect(result.jumpExceeded).toBe(true);
  });

  it("一度も課金が通っていない契約は動かない (ガード 2 の構造的な安全網)", () => {
    // 本番契約 25318162590 の実測値: cycle 1 が UNBILLED のままで、その
    // billingAttemptExpectedDate が契約の nextBillingDate と一致する。
    const result = decideNextBillingDate({
      cycles: [
        {
          cycleIndex: 1,
          status: "UNBILLED",
          skipped: false,
          billingAttemptExpectedDate: "2026-04-19T07:00:00Z",
          cycleStartAt: "2026-03-19T07:04:36Z",
          cycleEndAt: "2026-04-19T07:00:00Z",
        },
        {
          cycleIndex: 2,
          status: "UNBILLED",
          skipped: false,
          billingAttemptExpectedDate: "2026-05-19T07:00:00Z",
          cycleStartAt: "2026-04-19T07:00:01Z",
          cycleEndAt: "2026-05-19T07:00:00Z",
        },
      ],
      currentNextBillingDate: "2026-04-19T07:00:00Z",
    });
    expect(result.action).toBe("noop");
  });

  it("同じ入力なら何度でも同じ結論 (時計を読まない)", () => {
    const input = {
      cycles: REAL_CYCLES,
      currentNextBillingDate: REAL_NEXT_BILLING_DATE,
    };
    expect(decideNextBillingDate(input)).toEqual(decideNextBillingDate(input));
  });
});

// ─── getBillingCycles (Admin API 層) ─────────────────────────────────

describe("getBillingCycles", () => {
  it("index range selector を必ず送る", async () => {
    await getBillingCycles(CONTRACT_GID, { startIndex: 1, endIndex: 3 });
    expect(store.ranges).toEqual([{ startIndex: 1, endIndex: 3 }]);

    const sent = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string
    );
    expect(sent.variables.billingCyclesIndexRangeSelector).toEqual({
      startIndex: 1,
      endIndex: 3,
    });
    expect(sent.query).toContain("sortKey: CYCLE_INDEX");
  });

  it("startIndex 0 はローカルで弾く (Shopify は index out of range を返す)", async () => {
    await expect(
      getBillingCycles(CONTRACT_GID, { startIndex: 0, endIndex: 3 })
    ).rejects.toThrow(/startIndex/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("endIndex < startIndex はローカルで弾く", async () => {
    await expect(
      getBillingCycles(CONTRACT_GID, { startIndex: 5, endIndex: 4 })
    ).rejects.toThrow(/endIndex/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("実測上限を超える幅はローカルで弾く", async () => {
    await expect(
      getBillingCycles(CONTRACT_GID, {
        startIndex: 1,
        endIndex: BILLING_CYCLE_INDEX_MAX_SPAN + 1,
      })
    ).rejects.toThrow(/spans/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── getEarliestUnbilledCycle (窓の走査) ─────────────────────────────

describe("getEarliestUnbilledCycle", () => {
  it("既定の窓幅は 1 から始まる (index 0 を送らない)", async () => {
    await getEarliestUnbilledCycle(CONTRACT_GID, NO_WAIT);
    expect(store.ranges[0]).toEqual({
      startIndex: 1,
      endIndex: BILLING_CYCLE_INDEX_WINDOW,
    });
  });

  it("窓が全て BILLED なら次の窓へ進む", async () => {
    store.cycles = [
      cycle(1, { status: "BILLED" }),
      cycle(2, { status: "BILLED" }),
      cycle(3),
      cycle(4),
    ];
    const hit = await getEarliestUnbilledCycle(CONTRACT_GID, {
      windowSize: 2,
      ...NO_WAIT,
    });
    expect(hit?.cycleIndex).toBe(3);
    expect(store.ranges).toEqual([
      { startIndex: 1, endIndex: 2 },
      { startIndex: 3, endIndex: 4 },
    ]);
  });

  it("窓が埋まりきらなければ「UNBILLED なし」として null を返す", async () => {
    store.cycles = [cycle(1, { status: "BILLED" })];
    const hit = await getEarliestUnbilledCycle(CONTRACT_GID, {
      windowSize: 2,
      ...NO_WAIT,
    });
    expect(hit).toBeNull();
    expect(store.ranges).toHaveLength(1);
  });

  it("窓を使い切っても見つからなければ例外にする (無音の null を返さない)", async () => {
    store.cycles = [1, 2, 3, 4].map((i) => cycle(i, { status: "BILLED" }));
    await expect(
      getEarliestUnbilledCycle(CONTRACT_GID, {
        windowSize: 2,
        maxWindows: 2,
        ...NO_WAIT,
      })
    ).rejects.toThrow(/UNBILLED cycle が無い/);
  });

  it("既定の走査上限が定数として公開されている", () => {
    expect(BILLING_CYCLE_MAX_WINDOWS).toBeGreaterThan(1);
  });
});

// ─── advanceNextBillingDate (副作用あり) ─────────────────────────────

describe("advanceNextBillingDate", () => {
  it("実データの復旧ケース: 2026-10-12T04:00Z へ書き込む", async () => {
    const result = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(result.action).toBe("advanced");
    expect(result.from).toBe(REAL_NEXT_BILLING_DATE);
    expect(result.to).toBe(REAL_DERIVED);
    expect(store.writes).toEqual([
      { contractId: CONTRACT_GID, date: REAL_DERIVED },
    ]);
    expect(store.nextBillingDate).toBe(REAL_DERIVED);
  });

  it("導出値 == 現在値のとき mutation を呼ばない (ガード 1)", async () => {
    store.nextBillingDate = REAL_DERIVED;
    const result = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(result.action).toBe("noop");
    expect(store.writes).toEqual([]);
    expect(store.nextBillingDate).toBe(REAL_DERIVED);
  });

  it("導出値 < 現在値のとき書かず blocked_backward + Sentry warning (ガード 3)", async () => {
    store.nextBillingDate = "2027-06-01T00:00:00Z";
    const result = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(result.action).toBe("blocked_backward");
    expect(store.writes).toEqual([]);
    expect(store.nextBillingDate).toBe("2027-06-01T00:00:00Z");
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("blocked"),
      expect.objectContaining({ level: "warning" })
    );
  });

  it("UNBILLED cycle が無いとき無変更", async () => {
    store.cycles = [cycle(1, { status: "BILLED" })];
    const result = await advanceNextBillingDate(CONTRACT_GID, {
      windowSize: 2,
      ...NO_WAIT,
    });

    expect(result.action).toBe("no_unbilled_cycle");
    expect(store.writes).toEqual([]);
    expect(store.nextBillingDate).toBe(REAL_NEXT_BILLING_DATE);
  });

  it("2 回連続実行しても状態は同じ (冪等・mutation は 1 回だけ)", async () => {
    const first = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);
    const second = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(first.action).toBe("advanced");
    expect(second.action).toBe("noop");
    // 導出値は 2 回とも同一 = 走った回数で日付が飛ばない。
    expect(second.to).toBe(first.to);
    expect(store.writes).toHaveLength(1);
    expect(store.nextBillingDate).toBe(REAL_DERIVED);
  });

  it("飛び幅が 1 周期 + マージンを超えると Sentry error を出しつつ書く (ガード 4)", async () => {
    const result = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(result.jumpExceeded).toBe(true);
    expect(result.action).toBe("advanced");
    // 止めない: 書き込みは行われている。
    expect(store.writes).toHaveLength(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("further than one billing period"),
      expect.objectContaining({ level: "error" })
    );
  });

  it("1 周期ぶんの前進では Sentry を鳴らさない", async () => {
    store.nextBillingDate = "2026-09-12T04:00:01Z";
    const result = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(result.action).toBe("advanced");
    expect(result.jumpExceeded).toBe(false);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("書く直前に read-then-compare する (ガード 5)", async () => {
    await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);
    // 判定前 + 書く直前の 2 回読んでいる。
    expect(store.reads).toBe(2);
  });

  it("並行して他方が既に書いていれば noop に落ちる (ガード 5)", async () => {
    store.onRead = (s) => {
      // 2 回目の読み (書く直前) で、他方が導出値を書き終えた状態にする。
      if (s.reads === 2) s.nextBillingDate = REAL_DERIVED;
    };
    const result = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(result.action).toBe("noop");
    expect(store.writes).toEqual([]);
    expect(store.nextBillingDate).toBe(REAL_DERIVED);
  });

  it("並行更新で現在値が導出値より先に進んでいたら書かない (ガード 5 + 3)", async () => {
    store.onRead = (s) => {
      if (s.reads === 2) s.nextBillingDate = "2027-06-01T00:00:00Z";
    };
    const result = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(result.action).toBe("blocked_backward");
    expect(result.reason).toContain("並行更新を検知");
    expect(store.writes).toEqual([]);
  });

  it("読み取りが失敗したら failed に畳むが黙らない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: { subscriptionContract: null } }))
    );
    const result = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(result.action).toBe("failed");
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("mutation の userErrors も failed として上げる (無変更)", async () => {
    store.mutationUserError = "Billing date must be in the future";
    const result = await advanceNextBillingDate(CONTRACT_GID, NO_WAIT);

    expect(result.action).toBe("failed");
    expect(result.reason).toContain("Billing date must be in the future");
    expect(store.writes).toEqual([]);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("窓を使い切った失敗も failed として上がる", async () => {
    store.cycles = [1, 2, 3, 4].map((i) => cycle(i, { status: "BILLED" }));
    const result = await advanceNextBillingDate(CONTRACT_GID, {
      windowSize: 2,
      maxWindows: 2,
      ...NO_WAIT,
    });

    expect(result.action).toBe("failed");
    expect(result.from).toBe(REAL_NEXT_BILLING_DATE);
    expect(store.writes).toEqual([]);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
