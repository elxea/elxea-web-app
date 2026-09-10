/**
 * 操作の 3 分類 (`lib/interaction/mutation-classes.ts`) のテスト。
 *
 * ここで固定したいのは「どの分類でも押した瞬間に何かが出る」ことと、
 * **`optimistic` だけが受付を閉じない**という線引き。線引きが逆に倒れると、
 * 金銭・契約まで楽観更新にする / トグルまで押せなくする、のどちらかの事故になる。
 */
import { describe, it, expect } from "vitest";
import {
  MUTATION_CLASSES,
  IMMEDIATE_FEEDBACK_BUDGET_MS,
  immediateFeedbackFor,
  locksWhilePendingFor,
} from "@/lib/interaction/mutation-classes";

describe("操作の 3 分類", () => {
  it("分類は 3 つ (勝手に増やさない)", () => {
    expect([...MUTATION_CLASSES]).toEqual([
      "optimistic",
      "pessimistic-commit",
      "pessimistic-form",
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
  });

  it("やり直しの利く操作だけが、受付を閉じない", () => {
    /* ここが「2 秒動かない」の正体だった。既定を開けておく側に倒してある。 */
    expect(locksWhilePendingFor("optimistic")).toBe(false);
    /* 金銭・契約は待たせてでも 1 回に保つ (二重送信で実害が出る)。 */
    expect(locksWhilePendingFor("pessimistic-commit")).toBe(true);
    expect(locksWhilePendingFor("pessimistic-form")).toBe(true);
  });

  it("視覚反映の予算は Setaka 要件どおり 0.3 秒", () => {
    expect(IMMEDIATE_FEEDBACK_BUDGET_MS).toBe(300);
  });
});
