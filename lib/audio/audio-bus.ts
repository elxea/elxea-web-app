/**
 * サイト内で同時に鳴らせる音は 1 つだけ、を保証するための連絡係。
 *
 * elxea には性質の違う 2 系統の音がある:
 * - BGM      サイト全体に常駐する環境音 (`components/audio/audio-provider.tsx`)
 * - 記事音声 その記事の楽曲・インタビュー (`article-audio-provider.tsx`)
 *
 * Figma の AudioBlock / Track (8181:5288) の注記が
 * 「BGM (サイト全体) とは排他: この再生を始めたら BGM は止める」と定めている。
 * 逆方向 (BGM を鳴らしたら記事音声を止める) も同じ理由で要る — どちらかだけを
 * 実装すると「BGM を止めたつもりが記事音声と二重に鳴る」が残るため。
 *
 * なぜ React context ではなくモジュール level の連絡係か:
 * BGM の provider はルートレイアウトに、記事音声の provider は記事ページに置く。
 * 親子関係が固定できないので、どちらかを他方の context の内側に置く前提には
 * できない。両者が同じモジュールを import するだけで成立する形にしておく。
 *
 * 「止めろ」ではなく「自分が鳴り始めた」を放送する形にしているのは、止める
 * 判断を各 provider が自分の状態を見て行えるようにするため (放送側が相手の
 * 状態を知る必要がない)。
 */

export type AudioOwner = "bgm" | "article";

type Listener = (owner: AudioOwner) => void;

const listeners = new Set<Listener>();

/** 再生を始めたことを放送する。自分以外の owner は自分を止める。 */
export function announceAudioPlay(owner: AudioOwner): void {
  // 通知中に購読解除が起きても崩れないよう、写しを回す。
  for (const listener of [...listeners]) listener(owner);
}

/** 放送を購読する。戻り値を呼ぶと購読を解除する。 */
export function subscribeAudioPlay(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
