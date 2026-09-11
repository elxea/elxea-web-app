/**
 * Tests for `unlinkLineUser`（Firestore 側の連携解除セマンティクス）.
 *
 * route の契約は `__tests__/line-unlink-route.test.ts`。こちらは
 * 「解除 → 再連携」が **データの形として** 成立することを見る:
 *
 *   1. 連携済み → `lineUserId` を `FieldValue.delete()` で消す
 *      （null / 空文字での上書きではない）。action="unlinked"。
 *   2. 消した後は「写しが無い」状態から始まる（残骸が再連携に引っかからない）。
 *   3. 未連携ドキュメント / ドキュメント不在 → 書き込まず action="not_linked"。
 *   4. カルテ等の他フィールドは触らない（解除 != データ削除）。
 *   5. 名指しの解除（P8）は、写しが別の LINE のものなら触らない。
 *
 * 写しを**書く**関数はここには無い（2026-08-22 / P10 で `linkLineUser` を削除）。
 * 写しは `completeLineLinkage` が台帳の本人一致を確かめたあとにだけ書く。
 *
 * Firestore は「更新を実際に適用する」最小のフェイクで置き換える。delete
 * sentinel の判定には実物の `FieldValue.delete()` を使う（sentinel を素の
 * 文字列に差し替えても通ってしまうテストにしないため）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FieldValue } from "firebase-admin/firestore";

type DocData = Record<string, unknown>;

/** update payload の値が FieldValue.delete() sentinel かどうか（実物と等値比較）。 */
function isDeleteSentinel(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "isEqual" in value &&
    typeof (value as { isEqual: unknown }).isEqual === "function" &&
    (value as { isEqual: (other: unknown) => boolean }).isEqual(FieldValue.delete())
  );
}

const updateCalls: DocData[] = [];
const setCalls: DocData[] = [];
/** docPath -> データ。キーが無ければ「ドキュメント不在」。 */
let store: Map<string, DocData>;

function makeDocRef(path: string) {
  return {
    async get() {
      const data = store.get(path);
      return {
        exists: data !== undefined,
        data: () => (data === undefined ? undefined : { ...data }),
      };
    },
    async update(payload: DocData) {
      const current = store.get(path);
      if (current === undefined) throw new Error(`NOT_FOUND: ${path}`);
      updateCalls.push(payload);
      const next: DocData = { ...current };
      for (const [key, value] of Object.entries(payload)) {
        if (isDeleteSentinel(value)) delete next[key];
        else next[key] = value;
      }
      store.set(path, next);
    },
    async set(payload: DocData) {
      setCalls.push(payload);
      store.set(path, { ...payload });
    },
  };
}

vi.mock("@/lib/firebase/admin", () => ({
  getAdminFirestore: () => ({
    doc: (path: string) => makeDocRef(path),
  }),
}));

import { unlinkLineUser, getLinkedLineUserId } from "@/lib/firebase/server-actions";

const CUSTOMER_ID = "900800400001";
const USER_DOC = `users/${CUSTOMER_ID}`;
const LINE_USER_ID = "U0123456789abcdef0123456789abcdef";
const OTHER_LINE_USER_ID = "Ufedcba9876543210fedcba9876543210";

beforeEach(() => {
  updateCalls.length = 0;
  setCalls.length = 0;
  store = new Map();
});

describe("unlinkLineUser", () => {
  it("連携済み → lineUserId を FieldValue.delete() で消し、unlinked を返す", async () => {
    store.set(USER_DOC, { lineUserId: LINE_USER_ID, createdAt: new Date("2026-01-01") });

    const result = await unlinkLineUser(CUSTOMER_ID);
    expect(result).toEqual({ success: true, action: "unlinked" });

    // null 上書きではなく delete sentinel を使っている
    expect(updateCalls).toHaveLength(1);
    expect(isDeleteSentinel(updateCalls[0].lineUserId)).toBe(true);
    expect(updateCalls[0].lineUserId).not.toBeNull();
    expect(updateCalls[0].lineUserId).not.toBe("");

    // 実データからフィールドごと消えている（残骸なし）
    const after = store.get(USER_DOC) as DocData;
    expect("lineUserId" in after).toBe(false);
    expect(await getLinkedLineUserId(CUSTOMER_ID)).toBeNull();
  });

  it("解除後は「写しが無い」状態から始まる（残骸が再連携に引っかからない）", async () => {
    store.set(USER_DOC, { lineUserId: LINE_USER_ID });

    await unlinkLineUser(CUSTOMER_ID);
    expect(await getLinkedLineUserId(CUSTOMER_ID)).toBeNull();

    /* 再連携で写しを書くのは completeLineLinkage（台帳の本人一致を確かめたあと）。
       ここでは「未連携からの新規連携」と同じ状態になっていることだけを見る。 */
    store.set(USER_DOC, { ...(store.get(USER_DOC) as DocData), lineUserId: OTHER_LINE_USER_ID });
    expect(await getLinkedLineUserId(CUSTOMER_ID)).toBe(OTHER_LINE_USER_ID);

    // 別の LINE アカウントに差し替わっていても解除は成立する
    const again = await unlinkLineUser(CUSTOMER_ID);
    expect(again).toEqual({ success: true, action: "unlinked" });
    expect(await getLinkedLineUserId(CUSTOMER_ID)).toBeNull();
  });

  it("名指しの解除は別の LINE の写しを消さない（世帯共有・P8）", async () => {
    store.set(USER_DOC, { lineUserId: OTHER_LINE_USER_ID });

    const result = await unlinkLineUser(CUSTOMER_ID, LINE_USER_ID);

    expect(result).toEqual({ success: true, action: "not_linked" });
    expect(updateCalls).toHaveLength(0);
    expect(await getLinkedLineUserId(CUSTOMER_ID)).toBe(OTHER_LINE_USER_ID);
  });

  it("名指しが写しと一致すれば消す", async () => {
    store.set(USER_DOC, { lineUserId: LINE_USER_ID });

    const result = await unlinkLineUser(CUSTOMER_ID, LINE_USER_ID);

    expect(result).toEqual({ success: true, action: "unlinked" });
    expect(await getLinkedLineUserId(CUSTOMER_ID)).toBeNull();
  });

  it("解除は連携情報以外のフィールドを消さない（解除 != データ削除）", async () => {
    const createdAt = new Date("2026-01-01");
    store.set(USER_DOC, {
      lineUserId: LINE_USER_ID,
      createdAt,
      persona: "morning-quiet",
      favoriteCount: 3,
    });

    await unlinkLineUser(CUSTOMER_ID);

    const after = store.get(USER_DOC) as DocData;
    expect(after.createdAt).toBe(createdAt);
    expect(after.persona).toBe("morning-quiet");
    expect(after.favoriteCount).toBe(3);
    // lastActiveAt は解除時に更新される
    expect(after.lastActiveAt).toBeInstanceOf(Date);
  });

  it("未連携ドキュメント → 書き込まず not_linked（冪等）", async () => {
    store.set(USER_DOC, { createdAt: new Date("2026-01-01") });

    const result = await unlinkLineUser(CUSTOMER_ID);
    expect(result).toEqual({ success: true, action: "not_linked" });
    expect(updateCalls).toHaveLength(0);
  });

  it("lineUserId が null で残っているドキュメント → not_linked（書き込まない）", async () => {
    store.set(USER_DOC, { lineUserId: null });

    const result = await unlinkLineUser(CUSTOMER_ID);
    expect(result).toEqual({ success: true, action: "not_linked" });
    expect(updateCalls).toHaveLength(0);
  });

  it("ドキュメント不在 → 作らずに not_linked", async () => {
    const result = await unlinkLineUser(CUSTOMER_ID);
    expect(result).toEqual({ success: true, action: "not_linked" });
    expect(updateCalls).toHaveLength(0);
    expect(setCalls).toHaveLength(0);
    expect(store.has(USER_DOC)).toBe(false);
  });

  it("二重解除でも 2 回目は not_linked（同じ結果に収束する）", async () => {
    store.set(USER_DOC, { lineUserId: LINE_USER_ID });

    expect((await unlinkLineUser(CUSTOMER_ID)).action).toBe("unlinked");
    expect((await unlinkLineUser(CUSTOMER_ID)).action).toBe("not_linked");
    expect(updateCalls).toHaveLength(1);
  });
});
