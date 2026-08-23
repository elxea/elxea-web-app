import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeFirestore } from "./helpers/fake-firestore";

/**
 * 偽 Firestore の差し込み口が、本番では絶対に開かないことを固定する。
 *
 * ## なぜこのテストが要るのか
 *
 * `getAdminFirestore()` は「差し込みがあればそれを返す」ようになっている
 * （E2E で dev サーバーを本物の Firestore から切り離すため）。この分岐が本番でも開くと、
 * **書き込みが全部インメモリに落ちて黙って消える**。落ちないぶん、事故に気づく手掛かりが
 * どこにも残らない種類の壊れ方になる。
 *
 * 守りは 3 枚ある（env フラグ / NODE_ENV / 動的 import）が、機械で確かめられるのは
 * 「本番では throw する」ところ。ここが緩んだ瞬間に落ちるテストを 1 本置いておく。
 */
describe("E2E 用 Firestore 差し込み口", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    /* グローバルに置く仕組みなので、テスト間で必ず片付ける（残すと他のテストが
       偽 Firestore を掴む）。 */
    delete (globalThis as Record<string, unknown>).__elxeaE2eFirestore;
    vi.resetModules();
  });

  it("本番では差し込みを拒否する", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { setInjectedFirestoreForE2E, hasInjectedFirestoreForE2E } = await import(
      "@/lib/firebase/admin"
    );

    expect(() => setInjectedFirestoreForE2E(createFakeFirestore().db)).toThrow(
      /never run in production/,
    );
    expect(hasInjectedFirestoreForE2E()).toBe(false);
  });

  it("本番以外では差し込めて、getAdminFirestore がそれを返す", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { setInjectedFirestoreForE2E, getAdminFirestore, hasInjectedFirestoreForE2E } =
      await import("@/lib/firebase/admin");

    const fake = createFakeFirestore();
    setInjectedFirestoreForE2E(fake.db);

    expect(hasInjectedFirestoreForE2E()).toBe(true);
    /* 資格情報が 1 つも無い環境で `getAdminFirestore()` が返ってくること自体が、
       本物の初期化を通っていない証拠になる（通っていれば throw する）。 */
    expect(getAdminFirestore()).toBe(fake.db);
  });

  it("差し込みが無ければ本物の初期化に進む（資格情報が無ければ失敗する）", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "");
    const { getAdminFirestore } = await import("@/lib/firebase/admin");

    /* 「差し込みが無いときに黙って偽物へ落ちる」ことが無いのを、本物の経路が
       資格情報不足で失敗することで示す。 */
    expect(() => getAdminFirestore()).toThrow(/missing required env vars/);
  });
});
