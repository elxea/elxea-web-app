import { after } from "next/server";

import {
  applyLinkageEstablished,
  type LinkageCompletion,
  type LinkageSource,
} from "@/lib/auth/identity-link";

/**
 * 合体を「お客さまを待たせる時間」から切り離す（2026-08-25 / 白画面 20 秒の直し）。
 *
 * ## なぜ切り離してよいのか
 *
 * 連携が成立したかどうかは **台帳に行が立った時点で決まっている**。合体
 * （`users/line:<id>/**` を顧客の棚へ運ぶ）はその後始末で、転んでも連携は成立
 * したままにする、というのが元からの設計 — `applyLinkageEstablished` は throw
 * せず、callback は合体の結果に関わらず `?line_link=success` を返す。
 *
 * つまり **リダイレクトは合体の完了を待つ必要がない**。にもかかわらず待って
 * いたので、Firestore の往復（`iad1` ⇄ `asia-northeast1`）がそのまま白画面の
 * 長さになっていた。
 *
 * ## それでも「まず待つ」のはなぜか（全部 background に投げない理由）
 *
 * 合体が終わる前にマイページが描画されると、**お気に入りが空に見える**。これは
 * PR #100 の B3（「連携した瞬間にお気に入りが消えたように見える」）とお客さま
 * から見て**区別がつかない**。白画面を消すために、直したはずの見え方を戻す
 * のでは意味がない。
 *
 * 合体そのものを並行化して（`identity-merge.ts`）1 秒前後に収めたので、普通の
 * 棚なら予算内に終わる。予算を超えるのは、運ぶ荷物が桁違いに多い人だけ。その
 * 人にとっては「20 秒待たされる」より「先にマイページへ着いて、残りは裏で
 * 運ばれる」ほうが良い。
 *
 * ## 途中で離脱されても壊れない
 *
 * `after()` に渡した仕事は **レスポンス送出後にサーバ側で走り続ける**
 * （Vercel では `waitUntil` に載る）。ブラウザを閉じても・戻るを押しても
 * 中断されない。むしろ「合体の途中でブラウザが切れる」窓は、合体をレスポンス
 * より前に置いていた従来のほうが大きかった。
 *
 * 仮に `after()` の仕事ごと落ちても、合体は 4 段（確認 → 書く → 読み戻す →
 * 消す）で冪等・元を残す作りなので、**取りこぼしは次のメールログインで
 * `completeLineLinkage` が拾う**。どこで切れてもデータは消えない。
 */
export const MERGE_INLINE_BUDGET_MS = 2_500;

export type MergeHandoff =
  /** 予算内に合体が終わった。マイページは最初の描画で合体後の棚を見る。 */
  | "completed"
  /** 予算を超えたので `after()` に引き継いだ。応答は待たせない。 */
  | "handed-off";

/**
 * 合体を始め、`budgetMs` だけ待ち、終わっていなければ `after()` に引き継ぐ。
 *
 * @returns 予算内に終わったか、引き継いだか。**throw しない**。
 */
export async function applyLinkageEstablishedWithinBudget(
  args: {
    lineUserId: string;
    shopifyCustomerId: string;
    source: LinkageSource;
  },
  budgetMs: number = MERGE_INLINE_BUDGET_MS,
): Promise<MergeHandoff> {
  /* `applyLinkageEstablished` は「決して throw しない」約束だが、その約束が将来
     破れたときに **未処理の rejection でプロセスごと落ちる** のは割に合わない
     （合体は連携を失敗させてはいけない副作用）。ここで受け止めておく。 */
  const merging: Promise<LinkageCompletion | null> = applyLinkageEstablished(
    args,
  ).catch(() => null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<MergeHandoff>((resolve) => {
    timer = setTimeout(() => resolve("handed-off"), budgetMs);
  });

  const outcome = await Promise.race([
    merging.then<MergeHandoff>(() => "completed"),
    deadline,
  ]);

  /* 予算内に終わったのにタイマーが生きていると、その残り時間ぶん Node の
     イベントループが起きたままになり、関数の凍結が遅れる。 */
  clearTimeout(timer);

  if (outcome === "handed-off") {
    /* レスポンスを送ったあとも走り続けさせる。 */
    after(() => merging);
  }

  return outcome;
}
