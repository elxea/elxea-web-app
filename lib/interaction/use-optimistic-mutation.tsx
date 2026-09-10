"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";

import { logger } from "@/lib/log";

import type { MutationClass } from "./mutation-classes";
import { createWriteQueue, type WriteMode, type WriteOutcome } from "./write-queue";

/**
 * サーバへ書き込む操作の**共通の通り道**。分類は `mutation-classes.ts` が正本。
 *
 * 新しい機能はここを通すだけで、下の 4 つが最初から付いてくる。
 *
 *   1. **0.3 秒以内に画面が変わる** — 結果 (楽観) か進行 (悲観)
 *   2. **外れたら戻す** — 失敗したらサーバの値へ巻き戻る
 *   3. **黙って戻さない** — 戻すときは必ず `onFailure` で言い直す
 *   4. **連打で壊れない** — 同じ相手への往復は 1 本ずつに整理される
 *
 * ## なぜ「共通の 1 本」にしたか (Setaka 実機指摘 2026-08-26)
 *
 * 画面ごとに手書きしていたので、直しが片方にしか入らない状態が常態化していた。
 * カートの数量は押した瞬間に数字が動いていた (本番実測 16〜30ms) のに、
 * ボタンが本番実測 1,905〜2,062ms のあいだ `disabled` で、250ms 間隔の 2 回目が
 * 黙って捨てられていた (実測 6 → 7)。カートに追加も 2,561ms 受け付けなかった。
 * **速さではなく受付を閉じていた**という同じ間違いが、複数の画面に別々の形で
 * 書かれていた。だから規約を文にするのではなく、通り道の側に埋めた。
 */

export type { WriteOutcome };

/* -------------------------------------------------------------------------- */
/* optimistic — やり直しの利く操作 (トグル・数量)                                */
/* -------------------------------------------------------------------------- */

export type OptimisticMutationOptions<TValue, TInput> = {
  /**
   * この操作の名乗り。**固定文字列**にすること (`cart.line-quantity` など)。
   * 失敗の記録に付くタグなので、テンプレート文字列で毎回変えると数えられない
   * (憲章 Wave 3 / R1)。
   */
  operation: string;
  /** サーバが持っている本当の値 (RSC の props など)。 */
  value: TValue;
  /** 押されたときに画面へ**その場で**反映する規則。純関数にすること。 */
  reduce: (current: TValue, input: TInput) => TValue;
  /** 実際の書き込み。 */
  send: (input: TInput) => Promise<unknown>;
  /**
   * 連打をまとめる単位。同じ鍵の操作は 1 本ずつ直列に送られる。
   * 省略すると全操作が 1 本の列になる (相手が 1 つしかない画面向け)。
   */
  keyOf?: (input: TInput) => string;
  /**
   * 連打の捌き方 (`write-queue` の表を参照)。
   *
   * - `"latest"` (既定) — 送る値が**絶対量**のとき。途中を間引く
   * - `"all"` — 送る値が**加算**のとき。間引かず全部送る
   */
  mode?: WriteMode | ((input: TInput) => WriteMode);
  /** 失敗して巻き戻すときの言い直し。**省略不可** (黙って戻さないため)。 */
  onFailure: (input: TInput) => void;
};

export type OptimisticMutation<TValue, TInput> = {
  /** 画面が描くべき値。押した直後は楽観的な値、着地後はサーバの値。 */
  value: TValue;
  /** 操作を申し込む。着地の成否を返す。 */
  run: (input: TInput) => Promise<WriteOutcome>;
  /**
   * 書き込みが飛んでいるか。
   *
   * **`aria-busy` と進行の印にだけ使う。`disabled` に使わないこと** —
   * この分類は「受付を閉じない」が約束なので、閉じたい理由が別にある場合
   * (在庫切れ・下限) は、その理由を自分で書く。
   */
  isPending: boolean;
  /** 分類。lint と読み手のための名乗り。 */
  mutationClass: MutationClass;
};

export function useOptimisticMutation<TValue, TInput>({
  operation,
  value,
  reduce,
  send,
  keyOf,
  mode,
  onFailure,
}: OptimisticMutationOptions<TValue, TInput>): OptimisticMutation<TValue, TInput> {
  const [optimisticValue, applyOptimistic] = useOptimistic(value, reduce);
  const [isPending, startTransition] = useTransition();

  /* 交通整理は**この hook の生存期間で 1 つ**。描き直しのたびに作り直すと、
     行きがかりの往復を見失って直列化が効かなくなる。
     失敗の記録も交通整理の側が受け持つ (`write-queue` が唯一の合流点)。 */
  const queue = useRef(createWriteQueue<TInput>({ operation }));

  /* `send` / `onFailure` は呼び出し側で毎回新しく作られるのが普通なので、
     `run` の同一性を保つために ref 越しに読む (押すたびに子が描き直るのを防ぐ)。
     書き込みは効果の中で行う — 描画中に ref を書くと、React が同じ描画を
     やり直したときに食い違う (`react-hooks/refs`)。`run` は押されたときにしか
     走らないので、効果が流れたあとの値を読むことになる。 */
  const latest = useRef({ send, onFailure, keyOf, mode });
  useEffect(() => {
    latest.current = { send, onFailure, keyOf, mode };
  });

  const run = useCallback(
    (input: TInput): Promise<WriteOutcome> =>
      new Promise<WriteOutcome>((resolve) => {
        startTransition(async () => {
          /* 1. 先に画面を変える。 */
          applyOptimistic(input);

          /* 2. 送る。同じ鍵の連打はここで 1 本ずつに整理される。 */
          const { keyOf: key, mode: writeMode, send: doSend } = latest.current;
          const outcome = await queue.current.enqueue(
            key?.(input) ?? "default",
            input,
            (payload) => doSend(payload),
            typeof writeMode === "function" ? writeMode(input) : writeMode,
          );

          /* 3. 外れたら言い直す。巻き戻し自体は、この遷移が閉じた時点で
                `useOptimistic` がサーバの値に戻すことで起きる。 */
          if (outcome === "failed") latest.current.onFailure(input);
          resolve(outcome);
        });
      }),
    [applyOptimistic],
  );

  return { value: optimisticValue, run, isPending, mutationClass: "optimistic" };
}

/* -------------------------------------------------------------------------- */
/* pessimistic — 金銭・契約・フォーム                                            */
/* -------------------------------------------------------------------------- */

export type PessimisticMutationOptions<TInput> = {
  /**
   * この操作の名乗り。**固定文字列**にすること (`subscription.cancel` など)。
   * 失敗の記録に付くタグになる (憲章 Wave 3 / R1)。
   */
  operation: string;
  /** どちらの悲観か。`mutation-classes.ts` の表を参照。 */
  mutationClass: Extract<MutationClass, "pessimistic-commit" | "pessimistic-form">;
  /** 実際の書き込み。 */
  send: (input: TInput) => Promise<unknown>;
  /** 着地したときの後始末 (`router.refresh()` など)。 */
  onSuccess?: (input: TInput) => void;
  /** 失敗したときの言い直し。**省略不可**。 */
  onFailure: (input: TInput, error: unknown) => void;
};

export type PessimisticMutation<TInput> = {
  /** 操作を申し込む。二重送信は自動で弾く。 */
  run: (input: TInput) => Promise<WriteOutcome>;
  /**
   * 送信中か。**押した瞬間に true になる**ので、そのまま `disabled` と
   * 進行の印の両方に使ってよい (この分類は閉じるのが正しい)。
   */
  isPending: boolean;
  mutationClass: MutationClass;
};

/**
 * 取り消しの利かない操作。**結果は先に見せないが、進行は必ず即座に見せる**。
 *
 * 楽観更新をしないのは、外れたときに「成立したように見えたものが無かったことに
 * なる」のを避けるため。そのかわり `isPending` は同期的に立つので、呼び出し側は
 * 0.3 秒どころか次の描画で進行を出せる。
 */
export function usePessimisticMutation<TInput>({
  operation,
  mutationClass,
  send,
  onSuccess,
  onFailure,
}: PessimisticMutationOptions<TInput>): PessimisticMutation<TInput> {
  /* `useTransition` ではなく素の state を使う。`startTransition` の `isPending` は
     遷移が始まるまで立たないことがあり、**押した瞬間**を逃しうるため。 */
  const [isPending, setIsPending] = useState(false);
  const inFlight = useRef(false);

  const latest = useRef({ send, onSuccess, onFailure });
  useEffect(() => {
    latest.current = { send, onSuccess, onFailure };
  });

  const run = useCallback(async (input: TInput): Promise<WriteOutcome> => {
    /* 二重送信を弾く。契約に二度手を入れないための要。 */
    if (inFlight.current) return "failed";
    inFlight.current = true;
    setIsPending(true);
    try {
      await latest.current.send(input);
      latest.current.onSuccess?.(input);
      return "ok";
    } catch (e) {
      /* 金銭・契約・フォームが落ちた。顧客には `onFailure` で言い直すが、
         それだけでは**こちら側が気づけない**ので必ず記録も残す
         (憲章 Wave 3 / R1)。 */
      logger.error("ui.mutation.commit-failed", e, { operation, mutationClass });
      latest.current.onFailure(input, e);
      return "failed";
    } finally {
      inFlight.current = false;
      setIsPending(false);
    }
  }, [operation, mutationClass]);

  return { run, isPending, mutationClass };
}
