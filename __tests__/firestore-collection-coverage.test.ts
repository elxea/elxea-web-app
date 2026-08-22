/**
 * 「コレクションを足したのに、識別子の引っ越しで運ばれない」を機械で止める。
 *
 * ## なぜこのテストがあるか
 *
 * 合体（`lib/auth/identity-merge.ts`）はかつて favorites / follows /
 * eventRegistrations の 3 つを関数の中に直接書いていた。その後 `COLLECTIONS` に
 * behaviorLog / conversations / orders が足されたが、合体側は誰も直さなかった。
 * 結果、連携したお客さまの行動ログ・会話履歴・注文ミラーは `users/line:<id>/` に
 * 取り残され、**連携後はどのログイン手段からも読めない**場所に消えていた。
 *
 * 型（`Record<UserSubcollection, MergeStrategy>`）は「一覧に載ったものを運び
 * 忘れる」を止めるが、**一覧そのものへの載せ忘れ**は止められない。そこがここ。
 * `COLLECTIONS` に足した名前は、必ず次のどちらかに現れなければならない。
 *
 *   - `USER_SUBCOLLECTIONS`  … `users/{key}` の下。引っ越しで運ぶ
 *   - `NON_USER_COLLECTIONS` … 下ではない。運ばない（理由は定義側の doc）
 *
 * どちらにも書かなければこのテストが落ちる。落ちたときに求められているのは
 * テストを直すことではなく、**新しいコレクションを引っ越しの対象にするか
 * どうかを決めること**である。
 */
import { describe, expect, it } from "vitest";

import {
  COLLECTIONS,
  NON_USER_COLLECTIONS,
  USER_SUBCOLLECTIONS,
  userSubcollection,
} from "@/lib/firebase/collections";

describe("COLLECTIONS の全項目が引っ越しの可否を宣言している", () => {
  it("すべてのコレクションが「運ぶ」か「運ばない」のどちらかに属する", () => {
    const declared = [...USER_SUBCOLLECTIONS, ...NON_USER_COLLECTIONS].sort();
    const all = Object.values(COLLECTIONS).sort();

    /* 差分をそのまま見せる。落ちたとき「どれを書き忘れたか」が
       メッセージから直接読めるようにするため、集合演算の結果ではなく
       並べた配列どうしを比べる。 */
    expect(declared).toEqual(all);
  });

  it("どのコレクションも両方には属さない（運ぶ / 運ばないは排他）", () => {
    const overlap = USER_SUBCOLLECTIONS.filter((name) =>
      (NON_USER_COLLECTIONS as readonly string[]).includes(name),
    );
    expect(overlap).toEqual([]);
  });

  it("同じ名前を 2 度宣言していない", () => {
    const declared = [...USER_SUBCOLLECTIONS, ...NON_USER_COLLECTIONS];
    expect(new Set(declared).size).toBe(declared.length);
  });
});

describe("パスの組み立て", () => {
  it("userSubcollection は users/{key}/{sub} を返す", () => {
    expect(userSubcollection("7654321", "favorites")).toBe(
      "users/7654321/favorites",
    );
    expect(userSubcollection("line:U123", "behaviorLog")).toBe(
      "users/line:U123/behaviorLog",
    );
  });

  it("従来の専用ヘルパーと同じパスを返す（引っ越し先がずれない）", async () => {
    const {
      favoritesCol,
      followsCol,
      eventRegistrationsCol,
      behaviorLogCol,
      conversationsCol,
      ordersCol,
    } = await import("@/lib/firebase/collections");

    const key = "7654321";
    expect(userSubcollection(key, "favorites")).toBe(favoritesCol(key));
    expect(userSubcollection(key, "follows")).toBe(followsCol(key));
    expect(userSubcollection(key, "eventRegistrations")).toBe(
      eventRegistrationsCol(key),
    );
    expect(userSubcollection(key, "behaviorLog")).toBe(behaviorLogCol(key));
    expect(userSubcollection(key, "conversations")).toBe(conversationsCol(key));
    expect(userSubcollection(key, "orders")).toBe(ordersCol(key));
  });
});
