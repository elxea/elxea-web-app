/**
 * `lib/auth/linkage-merge-handoff.ts` — 合体を「お客さまを待たせる時間」から
 * 切り離す仕組みのテスト。
 *
 * ## 何を守るのか
 *
 * 連携 callback のリダイレクト内容は **合体の結果に依存しない**（台帳に行が
 * 立った時点で連携は成立しており、合体が転んでも `?line_link=success` を返す）。
 * にもかかわらず合体の完了を待ち切っていたので、Firestore への往復がそのまま
 * 白画面の長さになっていた（2026-08-25 本番: 20.1 秒）。
 *
 * かといって全部を裏に回すと、合体前のマイページが描画されて**お気に入りが
 * 空に見える** — PR #100 の B3 と、お客さまから見て区別がつかない壊れ方に
 * なる。だから「予算内なら待つ / 超えたら引き継ぐ」の 2 段にした。
 *
 * ここで固定するのはその 2 段の境目そのもの:
 *
 *   H1. 速い合体は**その場で終わらせる**（`after` に投げない = 描画が正しい）
 *   H2. 遅い合体は予算で打ち切って**応答を待たせない**
 *   H3. 打ち切った仕事は捨てず `after` に渡す（レスポンス後も走り続ける）
 *   H4. 合体が throw しても、呼び出し側には伝播しない（連携を失敗させない）
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const afterMock = vi.fn<(work: () => unknown) => void>();
vi.mock("next/server", () => ({ after: (work: () => unknown) => afterMock(work) }));

const applyLinkageEstablishedMock = vi.fn();
vi.mock("@/lib/auth/identity-link", () => ({
  applyLinkageEstablished: (args: unknown) => applyLinkageEstablishedMock(args),
}));

import {
  applyLinkageEstablishedWithinBudget,
} from "@/lib/auth/linkage-merge-handoff";

const ARGS = {
  lineUserId: "U0123456789abcdef0123456789abcdef",
  shopifyCustomerId: "7654321",
  source: "line-link-callback" as const,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("合体は予算内なら待ち、超えたら引き継ぐ", () => {
  it("H1: 予算内に終わる合体はその場で完了し、after には渡さない", async () => {
    applyLinkageEstablishedMock.mockResolvedValue({ outcome: "merged", merge: null });

    const outcome = await applyLinkageEstablishedWithinBudget(ARGS, 200);

    expect(outcome).toBe("completed");
    /* ここが "handed-off" に倒れると、マイページが合体前の棚を描いて
       「連携したらお気に入りが消えた」に見える。 */
    expect(afterMock).not.toHaveBeenCalled();
    expect(applyLinkageEstablishedMock).toHaveBeenCalledWith(ARGS);
  });

  it("H2: 予算を超える合体は応答を待たせない（予算ぶんで返る）", async () => {
    applyLinkageEstablishedMock.mockImplementation(async () => {
      await sleep(400);
      return { outcome: "merged", merge: null };
    });

    const from = Date.now();
    const outcome = await applyLinkageEstablishedWithinBudget(ARGS, 50);
    const waited = Date.now() - from;

    expect(outcome).toBe("handed-off");
    /* 合体は 400ms かかるのに、呼び出し側は 50ms の予算で解放される。
       ここが 400ms 側に張り付くと、白画面が合体の長さに引きずられる。 */
    expect(waited).toBeLessThan(300);
  });

  it("H3: 打ち切った合体は捨てずに after へ渡し、そこで完了する", async () => {
    let finished = false;
    applyLinkageEstablishedMock.mockImplementation(async () => {
      await sleep(120);
      finished = true;
      return { outcome: "merged", merge: null };
    });

    const outcome = await applyLinkageEstablishedWithinBudget(ARGS, 20);
    expect(outcome).toBe("handed-off");
    expect(afterMock).toHaveBeenCalledTimes(1);

    // 応答を返した時点ではまだ終わっていない。
    expect(finished).toBe(false);

    /* `after` に渡されたのは「走り続けている合体そのもの」。Vercel はこれを
       レスポンス送出後に待つ（= ブラウザを閉じても中断されない）。 */
    const work = afterMock.mock.calls[0]![0];
    await work();
    expect(finished).toBe(true);
  });

  it("H4: 合体が throw しても呼び出し側には伝播しない（連携は成立させたまま）", async () => {
    applyLinkageEstablishedMock.mockRejectedValue(new Error("firestore is gone"));

    /* `applyLinkageEstablished` は「throw しない」約束だが、その約束が破れた日に
       連携そのものを 500 で落とすのは割に合わない。 */
    await expect(
      applyLinkageEstablishedWithinBudget(ARGS, 200),
    ).resolves.toBe("completed");
  });
});
