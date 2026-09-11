/**
 * 操作の 4 分類 (`lib/interaction/mutation-classes.ts`) のテスト。
 *
 * ここで固定したいのは「どの分類でも押した瞬間に何かが出る」ことと、
 * **受付を閉じるのは悲観の 2 つだけ**という線引き。線引きが逆に倒れると、
 * 金銭・契約まで楽観更新にする / トグルまで押せなくする、のどちらかの事故になる。
 */
import { describe, it, expect } from "vitest";
import {
  MUTATION_CLASSES,
  IMMEDIATE_FEEDBACK_BUDGET_MS,
  immediateFeedbackFor,
  locksWhilePendingFor,
} from "@/lib/interaction/mutation-classes";

describe("操作の 4 分類", () => {
  it("分類は 4 つ (勝手に増やさない)", () => {
    /* 4 本目 `request-response` は「応答の本体が要る往復」(音声の入場券 /
       会話のストリーム)。成否しか返さない 3 本では機構として噛み合わず、
       例外表 (`ALLOWLIST`) に逃がすしかなかった穴をふさぐために足した
       (2026-09-12)。ここを増やすのは、通り道を増やすということ。 */
    expect([...MUTATION_CLASSES]).toEqual([
      "optimistic",
      "pessimistic-commit",
      "pessimistic-form",
      "request-response",
    ]);
  });

  it("どの分類でも、押した瞬間に必ず何かを出す", () => {
    for (const mutationClass of MUTATION_CLASSES) {
      /* 「何も出ない」という選択肢が型にも値にも存在しない。 */
      expect(["result", "progress"]).toContain(immediateFeedbackFor(mutationClass));
    }
  });

  it("やり直しの利く操作だけが、結果を先に見せる", () => {
    expect(immediateFeedbackFor("optimistic")).toBe("result");
    expect(immediateFeedbackFor("pessimistic-commit")).toBe("progress");
    expect(immediateFeedbackFor("pessimistic-form")).toBe("progress");
    /* 応答の本体が要る往復は、結果を先に見せられない (まだ手元に無い)。
       そのかわり進行は必ず出す。 */
    expect(immediateFeedbackFor("request-response")).toBe("progress");
  });

  it("受付を閉じるのは悲観の 2 つだけ", () => {
    /* ここが「2 秒動かない」の正体だった。既定を開けておく側に倒してある。 */
    expect(locksWhilePendingFor("optimistic")).toBe(false);
    /* 金銭・契約は待たせてでも 1 回に保つ (二重送信で実害が出る)。 */
    expect(locksWhilePendingFor("pessimistic-commit")).toBe(true);
    expect(locksWhilePendingFor("pessimistic-form")).toBe(true);
    /* 入場券の取得は二重送信の実害が無い。閉じると「押したのに何も起きない」
       だけが残るので、閉じずに相乗りさせる (`createRequestCoalescer`)。 */
    expect(locksWhilePendingFor("request-response")).toBe(false);
  });

  it("視覚反映の予算は Setaka 要件どおり 0.3 秒", () => {
    expect(IMMEDIATE_FEEDBACK_BUDGET_MS).toBe(300);
  });
});
