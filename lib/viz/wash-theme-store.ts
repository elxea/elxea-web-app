/**
 * 「いま開いている記事の号のテーマ色」を面へ伝えるための最小のストア。
 *
 * ## なぜ context ではないのか
 * 面 (`ReadingWash`) はルートグループの layout に置く。テーマ色を知っているのは
 * その **下** にある記事ページ (`elxea-journal/[slug]`) で、React の context は
 * 上から下へしか流れないので、下から上へは渡せない。
 *
 * 取れる手は 3 つあった:
 * 1. 面を layout ではなく各ページに置く — 記事から記事への遷移で面が作り直され、
 *    にじみが毎回描き直しになる。「ずっとそこにある空気」ではなくなるので却下
 * 2. layout でパスを見て Sanity を引き直す — 同じ記事を 2 回取ることになる。
 *    表示に必要な情報を 2 度取るのは断線の元 (画像の断線 #45 と同じ形) なので却下
 * 3. ページが登録し、面が購読する — 採用
 *
 * ## 状態が 1 つしかないこと
 * 同時に開いている記事は 1 つなので、値も 1 つでよい。ページがアンマウントされたら
 * 自分が入れた値だけを取り下げる (別の記事へ遷移して新しい値が入っていたら
 * 触らない) ので、遷移の順序に関わらず最後に開いた記事の色が残る。
 */

import type { JournalTheme } from "./theme-palette";

type Listener = () => void;

let current: JournalTheme | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

/** 面が購読する。`useSyncExternalStore` に渡す。 */
export function subscribeWashTheme(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWashTheme(): JournalTheme | null {
  return current;
}

/**
 * サーバー側の値。常に null。
 *
 * 面はマウント後にしか描かないので、サーバーでは「テーマ無し」で確定させる。
 * ここでクライアント側の値を返そうとするとハイドレーションがずれる。
 */
export function getWashThemeServerSnapshot(): JournalTheme | null {
  return null;
}

/** 記事が自分の号の色を登録する。戻り値を呼ぶと取り下げる。 */
export function setWashTheme(theme: JournalTheme | null): () => void {
  current = theme;
  emit();
  return () => {
    // 自分が入れた値のままなら消す。すでに次の記事の色が入っているなら触らない。
    if (current === theme) {
      current = null;
      emit();
    }
  };
}
