"use client";

import { useCallback, useOptimistic, useTransition } from "react";

/**
 * URL に載っている選択 (絞り込み・並び替え・言語・検索語) を切り替える操作の
 * **共通の通り道**。
 *
 * ## なぜ要るのか (網羅表 2026-08-27 / G5・G6・G9・G10)
 *
 * 書き込みには `lib/interaction` という 1 本の通り道があるが、**表示の切替には
 * 何も無かった**。そのため「押した瞬間に見た目が変わる」が画面ごとの手書きに
 * なり、実際にはどの画面にも書かれていなかった。
 *
 * 症状はどれも同じ形をしている:
 *
 *   - 商品一覧のカテゴリチップは `router.push` だけを呼ぶ。**塗り替えは
 *     サーバの往復が着地してから**なので、押しても数百 ms のあいだ
 *     「押した覚えのない画面」を見ることになる。
 *   - 並び替えの `<select>` は `value={activeSort}` の制御コンポーネントなので、
 *     選び直しても React が**古い値に引き戻す**。往復が着地するまで、選んだ
 *     はずの項目が選ばれていない状態が見える (押下が無視されたようにしか
 *     見えない)。
 *
 * どちらも原因は 1 つ — **サーバが持っている値だけを描いている**こと。だから
 * 直し方も 1 つで、`useOptimistic` で「押した値」を先に描き、遷移が着地したら
 * サーバの値へ自然に合流させる。合流は `useOptimistic` が構造的に持っている
 * (遷移が閉じた時点で `serverValue` に戻る) ので、巻き戻しの手当ては要らない。
 *
 * ## 書き込みの通り道と混ぜない
 *
 * ここは**サーバに何も書かない**操作専用。書き込みを伴う操作は今までどおり
 * `lib/interaction/use-optimistic-mutation` を通すこと (連打の直列化・失敗時の
 * 言い直し・記録はそちらが持っている)。この hook にはそれらが無い — 遷移は
 * 失敗しても URL が変わらないだけで、取り消すべき副作用が無いため。
 *
 * ## 使い方
 *
 * ```tsx
 * const nav = useOptimisticNavigation(activeSort);
 * <select
 *   value={nav.value}
 *   onChange={(e) => nav.navigate(e.target.value, () => router.push(href(e.target.value)))}
 * />
 * ```
 *
 * `navigate` の第 2 引数で実際の遷移を渡すのは、遷移の起こし方が呼び出し側
 * ごとに違う (`router.push` / `router.replace` / locale 付き) ため。**遷移を
 * `startTransition` の中で起こすことがこの hook の要点**で、外で起こすと
 * `useOptimistic` の楽観値が次の描画で即座に捨てられる。
 */
export type OptimisticNavigation<T> = {
  /** 画面が描くべき値。押した直後は押された値、着地後はサーバの値。 */
  value: T;
  /** 遷移が飛んでいるか。**進行の印にだけ使う** (受付を閉じない)。 */
  isNavigating: boolean;
  /** 選択を切り替える。`go` は実際の遷移 (`router.push` 等)。 */
  navigate: (next: T, go: () => void) => void;
};

export function useOptimisticNavigation<T>(serverValue: T): OptimisticNavigation<T> {
  const [value, setValue] = useOptimistic(serverValue);
  const [isNavigating, startNavigation] = useTransition();

  const navigate = useCallback(
    (next: T, go: () => void) => {
      startNavigation(() => {
        /* 先に見た目を変える。`useOptimistic` の更新は遷移の中でしか受け付け
           られないので、遷移の外に出さないこと。 */
        setValue(next);
        go();
      });
    },
    [setValue],
  );

  return { value, isNavigating, navigate };
}
