/**
 * 歓迎メールが「初回登録のときだけ・1 人につき 1 通だけ」であることを固定する。
 *
 * ## 直している事故（2026-08-30 本番）
 *
 * `/api/auth/callback` は送信条件を `orders.edges.length === 0`（注文履歴が無い）
 * 1 つだけで判定していた。**「注文したことが無い」は「いま登録したばかり」ではない**
 * ので、一度登録して一度も買っていない会員はログインするたびに
 * 「roji ご登録ありがとうございます」を受け取っていた。オーナーは過去のテストで
 * 登録済みのアドレスに再送されたことでこれを踏んだ。
 *
 * ## この検査が押さえている 1 対 N の非対称
 *
 * 送ってよいのは「新しさの陽性証拠がある」かつ「まだ送っていない」の**両方**が
 * 揃った 1 通りだけで、それ以外は全部送らない。片方だけを足した実装
 * （例: claim だけ追加して creationDate を見ない）は、登録から何日経っていても
 * 1 通目が出てしまうので、両方を別々のケースとして通す。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRESH_REGISTRATION_WINDOW_MS,
  isFreshRegistration,
} from "@/lib/email/welcome-gate";

describe("isFreshRegistration — 「いま登録した」の陽性判定", () => {
  const now = Date.parse("2026-08-30T04:00:00Z");

  it("数秒前に作られた顧客は初回登録とみなす", () => {
    expect(isFreshRegistration(new Date(now - 3_000), now)).toBe(true);
  });

  it("窓の境界ちょうどはまだ初回登録", () => {
    expect(
      isFreshRegistration(new Date(now - FRESH_REGISTRATION_WINDOW_MS), now),
    ).toBe(true);
  });

  it("窓を 1 ミリ秒でも過ぎたら初回登録ではない", () => {
    expect(
      isFreshRegistration(new Date(now - FRESH_REGISTRATION_WINDOW_MS - 1), now),
    ).toBe(false);
  });

  /* これが今回の事故そのもの: 過去に登録した人は、注文が 0 件でも「初回」ではない。 */
  it("5 日前に登録した人は（注文が無くても）初回登録ではない", () => {
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    expect(isFreshRegistration(new Date(now - fiveDays), now)).toBe(false);
  });

  it("読めなかった（null / undefined）ときは送らない側に倒す", () => {
    expect(isFreshRegistration(null, now)).toBe(false);
    expect(isFreshRegistration(undefined, now)).toBe(false);
  });

  it("不正な日付は送らない側に倒す", () => {
    expect(isFreshRegistration(new Date("not-a-date"), now)).toBe(false);
  });

  /* 時計のずれや壊れた値で窓が無限に広がらないこと。 */
  it("未来の日付は新しさの証拠にならない", () => {
    expect(isFreshRegistration(new Date(now + 60_000), now)).toBe(false);
  });
});

describe("claimWelcomeEmail — 1 顧客 1 通の権利取得", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Firestore の最小の贋作。`runTransaction` に渡された関数へ、
   * `get` / `set` を持つトランザクションを流す。ドキュメントは Map 1 つで持つ。
   */
  function fakeFirestore(initial: Record<string, unknown> | null) {
    const store: { doc: Record<string, unknown> | null } = { doc: initial };
    const setCalls: Array<Record<string, unknown>> = [];

    const db = {
      doc: () => ({
        set: (value: Record<string, unknown>) => {
          setCalls.push(value);
          store.doc = { ...(store.doc ?? {}), ...value };
          return Promise.resolve();
        },
      }),
      runTransaction: async (
        fn: (tx: {
          get: (ref: unknown) => Promise<{
            exists: boolean;
            get: (field: string) => unknown;
          }>;
          set: (ref: unknown, value: Record<string, unknown>) => void;
        }) => Promise<boolean>,
      ) =>
        fn({
          get: async () => ({
            exists: store.doc !== null,
            get: (field: string) => store.doc?.[field],
          }),
          set: (_ref, value) => {
            setCalls.push(value);
            store.doc = { ...(store.doc ?? {}), ...value };
          },
        }),
    };

    return { db, setCalls, store };
  }

  it("まだ送っていない人には権利が下りる", async () => {
    const { claimWelcomeEmail } = await import("@/lib/email/welcome-gate");
    const { db, setCalls } = fakeFirestore(null);

    const claim = await claimWelcomeEmail("cust-1", db as never);

    expect(claim.ok).toBe(true);
    // 送る前に印が付いている（送信後に付けると、落ちた回で二重送信になる）
    expect(setCalls).toHaveLength(1);
  });

  /* 再送事故の本体。同じ人に 2 回目は絶対に下ろさない。 */
  it("既に送った人には二度と権利が下りない", async () => {
    const { claimWelcomeEmail, WELCOME_SENT_FIELD } = await import(
      "@/lib/email/welcome-gate"
    );
    const { db, setCalls } = fakeFirestore({
      [WELCOME_SENT_FIELD]: "2026-08-25T00:00:00Z",
    });

    const claim = await claimWelcomeEmail("cust-1", db as never);

    expect(claim).toEqual({ ok: false, reason: "already-sent" });
    expect(setCalls).toHaveLength(0);
  });

  it("同じ人の 2 回目の呼び出しでは権利が下りない（同一プロセス内の連続ログイン）", async () => {
    const { claimWelcomeEmail } = await import("@/lib/email/welcome-gate");
    const { db } = fakeFirestore(null);

    const first = await claimWelcomeEmail("cust-1", db as never);
    const second = await claimWelcomeEmail("cust-1", db as never);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  /* 台帳が読めないのに送るのは「もう送ったか分からないまま外部送信する」こと。 */
  it("台帳に届かないときは送らない側に倒す（fail-closed）", async () => {
    const { claimWelcomeEmail } = await import("@/lib/email/welcome-gate");
    const db = {
      runTransaction: () => Promise.reject(new Error("unavailable")),
    };

    const claim = await claimWelcomeEmail("cust-1", db as never);

    expect(claim.ok).toBe(false);
    expect(claim.ok === false && claim.reason).toBe("ledger-unavailable");
  });

  it("顧客 ID が無ければ判定できないので送らない", async () => {
    const { claimWelcomeEmail } = await import("@/lib/email/welcome-gate");
    const { db } = fakeFirestore(null);

    const claim = await claimWelcomeEmail("", db as never);

    expect(claim).toEqual({ ok: false, reason: "no-customer-id" });
  });
});
