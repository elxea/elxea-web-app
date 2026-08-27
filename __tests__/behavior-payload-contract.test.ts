/**
 * 行動ログの**送り手と受け口の契約**。
 *
 * `lib/firebase/behavior-tracker.ts` が実際に組み立てた本文を、サーバの受け口
 * (`lib/validation/behavior-schema.ts`) にそのまま通す。片方だけ項目が増えたら
 * ここが落ちる。
 *
 * ## なぜこのテストが要るか
 *
 * 送り手は前から `durationSeconds` (読了までの秒数) を送っていたのに、受け口の
 * 白名簿には無く `.strict()` が弾いていた。返るのは 400 で、それは**ブラウザの
 * console にしか出ない**。結果、記事の読了イベントだけが丸ごと記録されないまま
 * 何か月も走り、人気記事の集計から読了が脱落していた (監査 P1-3 / 記事ページで
 * 3 回に 1 回の 400 として観測)。
 *
 * 型 (`BehaviorEventMetadata`) には最初から載っていたので、型検査でも捕まらない。
 * 「実際に送る本文」と「実際に受ける規則」を突き合わせる場所が無かったのが穴で、
 * それを塞ぐのがこのファイル。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { BehaviorBodySchema } from "@/lib/validation/behavior-schema";
import {
  trackPageView,
  trackArticleRead,
  trackProductView,
  trackFavoriteAdd,
  trackSearch,
  trackAudioPlay,
} from "@/lib/firebase/behavior-tracker";

/** 送り手が投げた本文と、それに付いた Content-Type を集める。 */
const sent: { body: unknown; contentType: string; url: string }[] = [];

beforeEach(() => {
  sent.length = 0;
  /* 送り手はログイン中のときだけ投げる (`document.cookie` の旗を見る)。
     読むのは `cookie` の 1 行だけなので、偽のブラウザはこれで足りる。 */
  (globalThis as { document?: { cookie: string } }).document = {
    cookie: "shop_auth=1",
  };
  /* 送り口は `navigator.sendBeacon` (2026-08-27 / 憲章 R9 で `fetch` から移行)。
     `fetch` を差し替えても**もう何も通らない**ので、偽物もこちらに置く。
     `sendBeacon` は Blob を受け取り、その `type` がそのまま Content-Type になる。 */
  vi.stubGlobal("navigator", {
    sendBeacon: vi.fn((url: string, blob: Blob) => {
      /* Blob.text() は Promise なので、本文の取り出しは同期にはできない。
         テスト側は `vi.waitFor` で着地を待つ。 */
      void blob.text().then((text) => {
        sent.push({ body: JSON.parse(text), contentType: blob.type, url });
      });
      return true;
    }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  /* `globalThis.navigator` は Node 22 では getter のみで代入できない
     (`Cannot set property navigator`)。stubGlobal / unstubAllGlobals で差し替える。 */
  vi.unstubAllGlobals();
  delete (globalThis as { document?: unknown }).document;
});

/** 送り手を 1 つ動かし、投げられた本文を返す。 */
async function payloadOf(send: () => void): Promise<unknown> {
  send();
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  return sent[0].body;
}

describe("送り手が組み立てた本文は、そのままサーバの受け口を通る", () => {
  it("記事の読了 (durationSeconds つき) — 監査 P1-3 の回帰", async () => {
    const body = await payloadOf(() =>
      trackArticleRead({
        contentId: "tea-time-as-luxury-slow-life-practice",
        category: "tea-culture",
        title: "お茶の時間",
        durationSeconds: 214,
      }),
    );

    /* 以前はここが `unrecognized_keys` で落ち、サーバは 400 を返していた。 */
    const parsed = BehaviorBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.metadata?.durationSeconds).toBe(214);
  });

  it("ページ閲覧", async () => {
    const body = await payloadOf(() =>
      trackPageView({ contentId: "slug", category: "tea-culture", title: "題" }),
    );
    expect(BehaviorBodySchema.safeParse(body).success).toBe(true);
  });

  it("商品の閲覧", async () => {
    const body = await payloadOf(() =>
      trackProductView({ productId: "tea-ats-o-05", title: "纁", category: "green" }),
    );
    expect(BehaviorBodySchema.safeParse(body).success).toBe(true);
  });

  it("お気に入りへの追加", async () => {
    const body = await payloadOf(() =>
      trackFavoriteAdd({ contentId: "slug", productId: "handle", type: "article" }),
    );
    expect(BehaviorBodySchema.safeParse(body).success).toBe(true);
  });

  it("検索", async () => {
    const body = await payloadOf(() => trackSearch({ query: "煎茶" }));
    expect(BehaviorBodySchema.safeParse(body).success).toBe(true);
  });

  it("記事内の音の再生", async () => {
    const body = await payloadOf(() =>
      trackAudioPlay({ contentId: "slug", kind: "interview", title: "第 1 回" }),
    );
    expect(BehaviorBodySchema.safeParse(body).success).toBe(true);
  });
});

describe("送り口の契約 (sendBeacon)", () => {
  /* `sendBeacon` は Blob の `type` をそのまま Content-Type にする。省くと
     `text/plain` で届き、サーバの `parseJsonBody` が本文を読む前に弾く。
     しかも返事は誰も見ないので、**落ちたことがどこにも出ない** — 読了イベントを
     数か月落とした監査 P1-3 と全く同じ形の失敗になる。だから型を明示で assert する。 */
  it("JSON として届く (Content-Type が application/json)", async () => {
    trackSearch({ query: "煎茶" });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].contentType).toBe("application/json");
    expect(sent[0].url).toBe("/api/user/behavior");
  });

  it("ログインしていなければ 1 件も送らない", async () => {
    (globalThis as { document?: { cookie: string } }).document = { cookie: "" };
    trackSearch({ query: "煎茶" });
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(0);
  });

  it("sendBeacon が無いブラウザでも例外を投げない", () => {
    vi.stubGlobal("navigator", {});
    expect(() => trackSearch({ query: "煎茶" })).not.toThrow();
  });
});

describe("受け口は不明な項目を拒み続ける", () => {
  it("白名簿に無い項目は通さない (`.strict()` を緩めていない)", () => {
    const parsed = BehaviorBodySchema.safeParse({
      action: "view_content",
      channel: "web",
      metadata: { contentId: "slug", somethingNew: "x" },
    });
    expect(parsed.success).toBe(false);
  });

  it("読了時間は数値のみ・24 時間まで", () => {
    const base = { action: "view_content", channel: "web" } as const;
    expect(
      BehaviorBodySchema.safeParse({ ...base, metadata: { durationSeconds: "214" } })
        .success,
    ).toBe(false);
    expect(
      BehaviorBodySchema.safeParse({ ...base, metadata: { durationSeconds: 86401 } })
        .success,
    ).toBe(false);
    expect(
      BehaviorBodySchema.safeParse({ ...base, metadata: { durationSeconds: 86400 } })
        .success,
    ).toBe(true);
  });
});
