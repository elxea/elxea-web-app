/**
 * J-1 案A — ワンタップ連携の「意思」が、どこまで緩んでどこから緩まないか。
 *
 * ## 何を緩めたのか
 *
 * G1 は「合体は本人一致を確認してから。**cookie の同居を意思の代わりにしない**」と
 * 定める。ワンタップは、その「意思」を行きと帰りのあいだだけ cookie で運ぶので、
 * G1 を一部緩める設計変更にあたる。
 *
 * ただし緩めたのは **意思の運び方だけ**で、「本人でなくてよい」には一切していない。
 * このテストはその境界を固定する。
 *
 * | 条件 | 何を防ぐか |
 * |---|---|
 * | 短命（10 分） | 放置された意思を後から拾われること |
 * | 1 回きり | 1 度の意思が 2 度目の連携に流用されること |
 * | **LINE ID 束縛** | 別の LINE セッションに差し替えて使われること |
 *
 * 3 つ目が本丸。共用端末で LINE が入れ替わっていたら、封筒があっても開かない。
 * これが無いと、まさに B5（他人のお気に入りの持ち去り）が別の形で復活する。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  LINK_INTENT_TTL_MS,
  openLinkIntent,
  sealLinkIntent,
} from "@/lib/auth/link-intent";

const LINE_A = "U0123456789abcdef0123456789abcdef";
const LINE_B = "Ufedcba9876543210fedcba9876543210";

const SAVED = { SESSION_SECRET: process.env.SESSION_SECRET };

beforeEach(() => {
  /* encryptToken / decryptToken が要求する鍵。実値は本番と無関係の固定値。 */
  process.env.SESSION_SECRET = "0".repeat(64);
});

afterEach(() => {
  if (SAVED.SESSION_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = SAVED.SESSION_SECRET;
  vi.restoreAllMocks();
});

describe("意思の封緘と開封", () => {
  it("押した人の LINE で開ける", () => {
    const sealed = sealLinkIntent(LINE_A)!;
    expect(sealed).toBeTruthy();
    const opened = openLinkIntent(sealed, LINE_A);
    expect(opened.ok).toBe(true);
    expect(opened.ok && opened.lineUserId).toBe(LINE_A);
  });

  it("中身は平文で cookie に載らない（LINE の userId を露出させない）", () => {
    const sealed = sealLinkIntent(LINE_A)!;
    expect(sealed).not.toContain(LINE_A);
  });

  /* ── ここが本丸 ── */
  it("別の LINE セッションでは開かない（共用端末で入れ替わった場合）", () => {
    const sealed = sealLinkIntent(LINE_A)!;
    const opened = openLinkIntent(sealed, LINE_B);
    expect(opened.ok).toBe(false);
    expect(!opened.ok && opened.reason).toBe("not-bound");
  });

  it("LINE セッションを失っていたら開かない（束縛を確認できない）", () => {
    const sealed = sealLinkIntent(LINE_A)!;
    const opened = openLinkIntent(sealed, null);
    expect(!opened.ok && opened.reason).toBe("not-bound");
  });

  it("10 分を過ぎたら開かない", () => {
    const t0 = 1_700_000_000_000;
    const sealed = sealLinkIntent(LINE_A, t0)!;
    expect(openLinkIntent(sealed, LINE_A, t0 + LINK_INTENT_TTL_MS - 1).ok).toBe(true);
    const expired = openLinkIntent(sealed, LINE_A, t0 + LINK_INTENT_TTL_MS + 1);
    expect(!expired.ok && expired.reason).toBe("expired");
  });

  /* 未来から来た意思を有効にする理由が無い（時計のずれ・改竄）。 */
  it("発行時刻が未来なら開かない", () => {
    const t0 = 1_700_000_000_000;
    const sealed = sealLinkIntent(LINE_A, t0)!;
    const opened = openLinkIntent(sealed, LINE_A, t0 - 1000);
    expect(!opened.ok && opened.reason).toBe("expired");
  });

  it("封筒が無いのは通常運転（absent）", () => {
    const opened = openLinkIntent(undefined, LINE_A);
    expect(!opened.ok && opened.reason).toBe("absent");
  });

  it("我々が発行していないものは開かない", () => {
    for (const junk of ["", "not-encrypted", "aaaa.bbbb.cccc"]) {
      const opened = openLinkIntent(junk, LINE_A);
      expect(opened.ok, `value=${JSON.stringify(junk)}`).toBe(false);
    }
  });

  it("空の LINE userId は封緘しない（意思として通用させない）", () => {
    expect(sealLinkIntent("")).toBeNull();
  });
});

/* ── 台帳への書き込み ─────────────────────────────────────────────── */

describe("establishLinkageFromIntent", () => {
  const SAVED_SYNC = { SYNC_API_SECRET: process.env.SYNC_API_SECRET };

  beforeEach(() => {
    process.env.SYNC_API_SECRET = "sync-secret";
  });
  afterEach(() => {
    if (SAVED_SYNC.SYNC_API_SECRET === undefined) delete process.env.SYNC_API_SECRET;
    else process.env.SYNC_API_SECRET = SAVED_SYNC.SYNC_API_SECRET;
  });

  function fetchWith(status: number) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: status >= 200 && status < 300, status } as unknown as Response;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("サーバ確定の識別子で台帳に書く", async () => {
    const { establishLinkageFromIntent } = await import("@/lib/auth/one-tap-link");
    const { impl, calls } = fetchWith(200);
    const r = await establishLinkageFromIntent({
      lineUserId: LINE_A,
      shopifyCustomerId: "7654321",
      fetchImpl: impl,
    });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toContain("/api/identity/link-liff");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      line_messaging_user_id: LINE_A,
      shopify_customer_id: "7654321",
    });
  });

  /* 恒久的な衝突（J-4: 1 LINE = 1 顧客）。障害ではないので、他の失敗と分ける。 */
  it("409 は conflict として返す（rejected に丸めない）", async () => {
    const { establishLinkageFromIntent } = await import("@/lib/auth/one-tap-link");
    const { impl } = fetchWith(409);
    const r = await establishLinkageFromIntent({
      lineUserId: LINE_A,
      shopifyCustomerId: "7654321",
      fetchImpl: impl,
    });
    expect(!r.ok && r.reason).toBe("conflict");
  });

  it("鍵が無ければ呼びに行かない（fail-closed）", async () => {
    delete process.env.SYNC_API_SECRET;
    const { establishLinkageFromIntent } = await import("@/lib/auth/one-tap-link");
    const { impl, calls } = fetchWith(200);
    const r = await establishLinkageFromIntent({
      lineUserId: LINE_A,
      shopifyCustomerId: "7654321",
      fetchImpl: impl,
    });
    expect(!r.ok && r.reason).toBe("not-configured");
    expect(calls).toHaveLength(0);
  });

  it("届かなくても throw しない（ログインを失敗させない）", async () => {
    const { establishLinkageFromIntent } = await import("@/lib/auth/one-tap-link");
    const impl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await establishLinkageFromIntent({
      lineUserId: LINE_A,
      shopifyCustomerId: "7654321",
      fetchImpl: impl,
    });
    expect(!r.ok && r.reason).toBe("unreachable");
  });
});
