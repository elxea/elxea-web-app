/**
 * 匿名の来訪者を L0 に載せる道は、**同意があるときだけ開く**（CDP 統合 Stage 1 / 欠陥 D2）。
 *
 * ## なぜこのテストが要るか
 *
 * この段で開けたのは「ログインしていない人の行動を記録する」道であり、開け方を
 * 間違えると **同意していない人を追跡する** ことになる。壊れ方は静かで、
 * 画面にも応答にも何も出ない — 同意バナーは正しく出たまま、裏で送られる。
 *
 * 守るのは 3 つ:
 *   1. 同意が無ければ、端末に **ID を保存しない**（読みにも行かない）
 *   2. 同意が無ければ、サーバは L0 へ送らない（送り手が何を送ってきても）
 *   3. 会員の出来事は、どの鍵で積むかが身元どおりに決まる
 *
 * 1 は送り手側（ブラウザ）、2 はサーバ側。**どちらか片方でも通れば漏れる**ので、
 * 両方を別々に確かめる（二重ゲート）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  ANONYMOUS_ID_STORAGE_KEY,
  formatAnonymousId,
  getOrIssueAnonymousId,
  isAnonymousId,
} from "@/lib/cdp/anonymous-id";
import { resolveBehaviorSubject, toBehaviorGatewayEvent } from "@/lib/cdp/behavior-fact";
import { BehaviorActionSchema } from "@/lib/validation/behavior-schema";
import type { BehaviorAction } from "@/lib/firebase/types";

// ---------------------------------------------------------------------------
// 1. 送り手（ブラウザ）— 同意が無ければ端末に痕跡を残さない
// ---------------------------------------------------------------------------

function stubBrowser(consent: string | null, stored?: string) {
  const store = new Map<string, string>();
  if (stored) store.set(ANONYMOUS_ID_STORAGE_KEY, stored);
  if (consent) store.set("cookie-consent", consent);

  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    crypto: {
      getRandomValues: (a: Uint8Array) => {
        a.fill(0xab);
        return a;
      },
    },
  });
  (globalThis as { document?: { cookie: string } }).document = { cookie: "" };
  return store;
}

describe("匿名 ID は同意があるときだけ発行される", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { document?: unknown }).document;
  });

  it("同意 all なら発行して保存する", () => {
    const store = stubBrowser("all");
    const id = getOrIssueAnonymousId();
    expect(id).not.toBeNull();
    expect(isAnonymousId(id)).toBe(true);
    expect(store.get(ANONYMOUS_ID_STORAGE_KEY)).toBe(id);
  });

  it("同意が essential なら発行しない（保存もしない）", () => {
    const store = stubBrowser("essential");
    expect(getOrIssueAnonymousId()).toBeNull();
    expect(store.has(ANONYMOUS_ID_STORAGE_KEY)).toBe(false);
  });

  it("未選択なら発行しない（既定は「同意していない」側に倒れる）", () => {
    const store = stubBrowser(null);
    expect(getOrIssueAnonymousId()).toBeNull();
    expect(store.has(ANONYMOUS_ID_STORAGE_KEY)).toBe(false);
  });

  it("同意を外した後は、既に保存済みの ID も読みに行かない", () => {
    stubBrowser("essential", "a".repeat(32));
    expect(getOrIssueAnonymousId()).toBeNull();
  });

  it("同意 all で 2 回呼んでも同じ ID（訪問のたびに別人にならない）", () => {
    stubBrowser("all");
    expect(getOrIssueAnonymousId()).toBe(getOrIssueAnonymousId());
  });

  it("localStorage が使えない環境では発行しない（保存できない ID を送らない）", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("storage blocked");
        },
        setItem: () => {
          throw new Error("storage blocked");
        },
      },
      crypto: { getRandomValues: (a: Uint8Array) => a },
    });
    expect(getOrIssueAnonymousId()).toBeNull();
  });

  it("ID は 32 桁の 16 進数で、時刻も端末情報も含まない", () => {
    const id = formatAnonymousId(new Uint8Array(16).fill(0x0f));
    expect(id).toBe("0f".repeat(16));
    expect(isAnonymousId(id)).toBe(true);
    expect(isAnonymousId("not-hex")).toBe(false);
    expect(isAnonymousId("ab".repeat(20))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. サーバ側 — 送り手が何を送ってきても、同意 cookie が無ければ通さない
// ---------------------------------------------------------------------------

const ANON = "b".repeat(32);
const ANONYMOUS = { authenticated: false };

describe("サーバは同意 cookie をもう一度見る（fail-closed の二重ゲート）", () => {
  it("同意 all + 匿名 ID → web_anonymous_id で積む", () => {
    const r = resolveBehaviorSubject(ANONYMOUS, ANON, "all");
    expect(r).toEqual({ kind: "web_anonymous_id", value: ANON });
  });

  it("同意が essential なら、匿名 ID が送られてきても通さない", () => {
    const r = resolveBehaviorSubject(ANONYMOUS, ANON, "essential");
    expect(r).toEqual({ kind: null, reason: "anonymous_without_consent" });
  });

  it("同意 cookie が無ければ通さない（未選択は「同意していない」）", () => {
    expect(resolveBehaviorSubject(ANONYMOUS, ANON, null).kind).toBeNull();
  });

  it("読めない同意値は通さない（推測で許可側に倒さない）", () => {
    expect(resolveBehaviorSubject(ANONYMOUS, ANON, "maybe").kind).toBeNull();
  });

  it("同意はあっても ID が無ければ、理由を付けて積まない", () => {
    const r = resolveBehaviorSubject(ANONYMOUS, undefined, "all");
    expect(r).toEqual({ kind: null, reason: "anonymous_id_missing" });
  });
});

describe("会員の出来事は身元どおりの鍵で積む", () => {
  it("Shopify 会員は顧客番号で積む（連携済みなら本カルテの鍵と一致する）", () => {
    const r = resolveBehaviorSubject(
      { authenticated: true, shopifyCustomerId: "7654321", lineUserId: null },
      undefined,
      null,
    );
    expect(r).toEqual({ kind: "shopify_customer_id", value: "7654321" });
  });

  it("LINE ログインだけの人は LINE Login の sub で積む（Messaging の userId とは別 kind）", () => {
    const r = resolveBehaviorSubject(
      { authenticated: true, shopifyCustomerId: null, lineUserId: "Uline123" },
      undefined,
      null,
    );
    expect(r).toEqual({ kind: "line_login_uid", value: "Uline123" });
  });

  it("会員は同意 cookie が無くても積む（会員の記録は解析同意とは別の根拠で持っている）", () => {
    const r = resolveBehaviorSubject(
      { authenticated: true, shopifyCustomerId: "7654321" },
      undefined,
      "essential",
    );
    expect(r.kind).toBe("shopify_customer_id");
  });

  it("身元が解けなかったら理由を付けて積まない（黙って匿名に落とさない）", () => {
    const r = resolveBehaviorSubject({ authenticated: true }, ANON, "all");
    expect(r).toEqual({ kind: null, reason: "identity_unresolved" });
  });
});

// ---------------------------------------------------------------------------
// 3. L0 へ渡す形 — PII を持ち込まない
// ---------------------------------------------------------------------------

describe("L0 に渡すイベントは自由文と生の識別子を持ち込まない", () => {
  const AT = "2026-08-29T00:00:00.000Z";

  it("payload に載るのは ID 相当と数値だけ（検索語・ボタン文言は載らない）", () => {
    const ev = toBehaviorGatewayEvent(
      { kind: "web_anonymous_id", value: ANON },
      "view_content",
      { contentId: "tea-time", durationSeconds: 214 },
      AT,
    );
    expect(ev.payload).toEqual({
      content_id: "tea-time",
      product_id: null,
      duration_seconds: 214,
    });
    expect(JSON.stringify(ev.payload)).not.toContain(ANON);
  });

  it("同じ出来事なら dedupe が同じ（再送で 2 行にならない）", () => {
    const make = () =>
      toBehaviorGatewayEvent(
        { kind: "web_anonymous_id", value: ANON },
        "view_product",
        { productId: "p-1" },
        AT,
      );
    expect(make().dedupe).toBe(make().dedupe);
  });

  it("event_type は L0 の命名（behavior.<action>）に揃っている", () => {
    const ev = toBehaviorGatewayEvent(
      { kind: "shopify_customer_id", value: "7654321" },
      "audio_play",
      {},
      AT,
    );
    expect(ev.event_type).toBe("behavior.audio_play");
    expect(ev.channel).toBe("web");
    expect(ev.source).toBe("web-app.behavior");
  });
});

// ---------------------------------------------------------------------------
// 4. 語彙のずれを見えるようにする（D3）
// ---------------------------------------------------------------------------

describe("受け口の語彙は型の語彙からはみ出さない（D3 の三分裂を見える状態に保つ）", () => {
  /**
   * 行動語彙は 3 か所にある（cx-agent 14 値 / ここの型 10 値 / ここの zod 7 値）。
   * L0 の登録簿（cx-agent `src/lib/cdp/event-vocabulary.ts`）が全体の正本で、
   * この 3 つはその部分集合であるべき。
   *
   * ここで固定するのは **zod ⊆ 型** の関係だけ。zod のほうが狭いのは意図的で
   * （ブラウザから来る値は信用しないので入口を絞る）、問題は「型にある値を
   * zod が黙って弾く」のではなく「zod にしか無い値ができる」ほう —
   * それは受け口が型の知らない語を受け入れているという意味になる。
   */
  it("zod の値はすべて型の union に含まれる", () => {
    const typeValues: BehaviorAction[] = [
      "tap_button",
      "view_content",
      "view_product",
      "purchase",
      "line_message",
      "search",
      "audio_play",
      "tea_mention",
      "flavor_preference",
      "topic_interest",
    ];
    for (const v of BehaviorActionSchema.options) {
      expect(typeValues).toContain(v);
    }
  });
});
