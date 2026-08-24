import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LocalFirestoreGuardError,
  resolveClientFirestoreTarget,
  resolveServerFirestoreTarget,
  splitEmulatorHost,
} from "@/lib/firebase/firestore-target";

/**
 * 手元の開発・テストが本番 Firestore へ繋がらないことを固定する。
 *
 * ## なぜこのテストが要るのか
 *
 * これが緩むと `pnpm dev` が本番のデータを書き換える。読みは気づけず、書きは戻せない。
 * しかも「動いてしまう」ので、壊れていることが誰にも見えない種類の事故になる。
 *
 * 同時に **本番の経路を変えていない** ことも固定する。この変更で本番の挙動が 1 ミリでも
 * 動いたら、それは目的ではなく事故なので、そちらも機械で確かめる。
 */

/** 本番のサービスアカウントが手元に揃っている状況を作る（値はダミー）。 */
function stubProductionCredentials(): void {
  vi.stubEnv("FIREBASE_PROJECT_ID", "elxea-test-project");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "sa@elxea-test-project.iam.gserviceaccount.com");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----");
}

describe("Firestore の向き先の判定", () => {
  beforeEach(() => {
    /* 実行者のシェルに残っている値を持ち込まない。持ち込むと「手元では通るのに
       CI では落ちる（逆も）」という、いちばん時間を溶かす壊れ方になる。 */
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "");
    vi.stubEnv("NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "");
    vi.stubEnv("ALLOW_PRODUCTION_FIRESTORE", "");
    vi.stubEnv("NEXT_PUBLIC_ALLOW_PRODUCTION_FIRESTORE", "");
    vi.stubEnv("VERCEL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("サーバー側", () => {
    it("手元では、資格情報が揃っていても本番へ向かわせない", () => {
      vi.stubEnv("NODE_ENV", "development");

      expect(() => resolveServerFirestoreTarget()).toThrow(LocalFirestoreGuardError);
      expect(() => resolveServerFirestoreTarget()).toThrow(/本番 Firestore への接続を止めました/);
    });

    it("止めるときは、次に何をすればいいかを一緒に出す", () => {
      vi.stubEnv("NODE_ENV", "development");

      /* 「止まった」だけだと詰まる。エミュレーター・偽物・明示許可の 3 つの逃げ道を
         その場に書いておくのが、この止め方を運用に耐えさせている部分。 */
      expect(() => resolveServerFirestoreTarget()).toThrow(/pnpm emulator:start/);
      expect(() => resolveServerFirestoreTarget()).toThrow(/E2E_FIRESTORE_STUB=1/);
      expect(() => resolveServerFirestoreTarget()).toThrow(/ALLOW_PRODUCTION_FIRESTORE=1/);
    });

    it("エミュレーターが立っていればそちらへ向く（資格情報は要らない）", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");

      expect(resolveServerFirestoreTarget()).toEqual({
        kind: "emulator",
        host: "127.0.0.1:8080",
        /* 本物の project id は使わない。demo- で始まる id は実サービスへ出て行かない。 */
        projectId: "demo-elxea",
      });
    });

    it("明示的に許したときだけ、手元から本番へ向かえる", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ALLOW_PRODUCTION_FIRESTORE", "1");

      expect(resolveServerFirestoreTarget()).toEqual({ kind: "production" });
    });

    it("本番ランタイムは従来どおり素通りする（NODE_ENV=production）", () => {
      vi.stubEnv("NODE_ENV", "production");

      expect(resolveServerFirestoreTarget()).toEqual({ kind: "production" });
    });

    it("本番ランタイムは従来どおり素通りする（Vercel）", () => {
      /* Vercel のプレビューは NODE_ENV が production とは限らないので、VERCEL も見る。 */
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("VERCEL", "1");

      expect(resolveServerFirestoreTarget()).toEqual({ kind: "production" });
    });

    it("エミュレーターの指定は本番ランタイムより先に効く", () => {
      /* 順番を逆にすると「本番で emulator 変数が紛れ込んでも黙って本番を書く」に
         なってしまう。事故ったときに気づけるのは、指定どおり止まる側。 */
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");

      expect(resolveServerFirestoreTarget()).toMatchObject({ kind: "emulator" });
    });

    it("空文字は「指定なし」として扱う", () => {
      /* `FIRESTORE_EMULATOR_HOST=` と書かれた .env を読んだときに、
         空文字のホストへ繋ぎに行かないこと。 */
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("FIRESTORE_EMULATOR_HOST", "   ");

      expect(() => resolveServerFirestoreTarget()).toThrow(LocalFirestoreGuardError);
    });
  });

  describe("ブラウザ側", () => {
    it("手元では本番へ向かわせない", () => {
      vi.stubEnv("NODE_ENV", "development");

      expect(() => resolveClientFirestoreTarget()).toThrow(LocalFirestoreGuardError);
    });

    it("本番ビルドでは従来どおり本番へ向く", () => {
      vi.stubEnv("NODE_ENV", "production");

      expect(resolveClientFirestoreTarget()).toEqual({ kind: "production" });
    });

    it("エミュレーターが立っていればそちらへ向く", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
      vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-elxea");

      expect(resolveClientFirestoreTarget()).toMatchObject({
        kind: "emulator",
        host: "127.0.0.1:8080",
      });
    });
  });

  describe("host:port の読み取り", () => {
    it("ホストとポートに分解する", () => {
      expect(splitEmulatorHost("127.0.0.1:8080")).toEqual({ host: "127.0.0.1", port: 8080 });
      expect(splitEmulatorHost("localhost:9999")).toEqual({ host: "localhost", port: 9999 });
    });

    it("ポートの無い指定は誤設定として止める", () => {
      /* 黙って既定ポートに落とすと「繋がらない理由が分からない」時間が生まれる。 */
      expect(() => splitEmulatorHost("127.0.0.1")).toThrow(LocalFirestoreGuardError);
    });
  });
});

describe("getAdminFirestore の実際の分岐", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "");
    vi.stubEnv("ALLOW_PRODUCTION_FIRESTORE", "");
    vi.stubEnv("VERCEL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as Record<string, unknown>).__elxeaE2eFirestore;
    vi.resetModules();
  });

  it("手元で資格情報が揃っていると、本番へ繋ぐ前に止まる", async () => {
    vi.stubEnv("NODE_ENV", "development");
    stubProductionCredentials();

    const { getAdminFirestore } = await import("@/lib/firebase/admin");

    expect(() => getAdminFirestore()).toThrow(/本番 Firestore への接続を止めました/);
  });

  it("資格情報が無いときの文言は従来のまま（他所がこの文言で判定している）", async () => {
    /* lib/journal/popular-articles.ts が "missing required env vars" を見て
       「未設定」と分類している。ガードを資格情報チェックより後ろに置いた理由がこれ。 */
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "");

    const { getAdminFirestore } = await import("@/lib/firebase/admin");

    expect(() => getAdminFirestore()).toThrow(/missing required env vars/);
  });

  it("エミュレーター指定があれば、資格情報が 1 つも無くても初期化できる", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "");

    const { getAdminFirestore } = await import("@/lib/firebase/admin");

    /* 返ってくること自体が「本番の資格情報の経路を通っていない」証拠になる
       （通っていれば資格情報不足で throw する）。 */
    const db = getAdminFirestore();
    expect(db).toBeTruthy();
    expect(typeof db.collection).toBe("function");
  });
});
