/**
 * サイト内で同時に鳴らせる音は 1 つだけ、を保証するための連絡係。
 *
 * elxea には性質の違う 3 系統の音がある:
 * - BGM      サイト全体に常駐する環境音 (`components/audio/audio-provider.tsx`)
 * - 記事音声 その記事の楽曲・インタビュー (`article-audio-provider.tsx`)
 * - 音声会話 roji の音声チャットの返事 (`lib/voice/audio-queue.ts`)
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
 *
 * ---
 * ## 2026-09-11 拡張 (音声会話を 3 人目の参加者にする)
 *
 * 音声会話は BGM / 記事音声と違い **「始まって終わる」** ものである。開始しか
 * 放送できない形のままだと「お茶の話をしたら BGM が二度と戻らない」が確定する。
 * そこで放送の中身を「誰が」から **「誰が・始まりか終わりか」** に広げた。
 *
 * 拡張の条件として守っていること (これを崩すと既存 2 ファイルの改修が要る):
 *
 * 1. `announceAudioPlay` / `subscribeAudioPlay` は **名前も引数も意味も変えない**。
 *    前者は「始まり」の放送の別名、後者は「始まりだけを通す薄い包み」として残る。
 * 2. よって `components/audio/article-audio-provider.tsx` は **無改修**で正しく動く。
 * 3. 「同時に鳴る音は 1 つ」を決める場所は **このモジュール 1 箇所のまま** (単一正本)。
 *    音声会話のために別系統の排他を作らない。
 *
 * 終わりの放送 (`announceAudioRelease`) を今使うのは音声会話だけである。将来 BGM が
 * 実際に載ったとき、BGM 側が `subscribeAudioPhase` で `"release"` を見て自分を
 * 再開すればよく、音声側の配線は 1 行も要らない。
 *
 * なお「止める」ではなく「音量を下げる (ducking)」は採らない。マイクが動いている
 * 間 iOS は端末を録音兼再生モードに切り替えるため、他の音の音量・出力先を OS が
 * 勝手に変える。「小さく鳴らし続ける」はどの端末でも同じように届く約束にならない。
 */

export type AudioOwner = "bgm" | "article" | "voice";

/**
 * 放送の種類。
 * - `"start"`   自分が鳴り始めた (自分以外の owner は自分を止める)
 * - `"release"` 自分が鳴り終わって場を空けた (止めていた owner は再開してよい)
 */
export type AudioPhase = "start" | "release";

type Listener = (owner: AudioOwner) => void;
type PhaseListener = (owner: AudioOwner, phase: AudioPhase) => void;

const listeners = new Set<PhaseListener>();

/**
 * 「誰が・始まりか終わりか」を放送する。`announceAudioPlay` /
 * `announceAudioRelease` の実体。
 */
export function announceAudioPhase(owner: AudioOwner, phase: AudioPhase): void {
  // 通知中に購読解除が起きても崩れないよう、写しを回す。
  for (const listener of [...listeners]) listener(owner, phase);
}

/**
 * 再生を始めたことを放送する。自分以外の owner は自分を止める。
 *
 * 既存の呼び出し元との互換のため、名前・引数・意味は変えていない
 * (`announceAudioPhase(owner, "start")` の別名)。
 */
export function announceAudioPlay(owner: AudioOwner): void {
  announceAudioPhase(owner, "start");
}

/**
 * 再生が終わって場を空けたことを放送する。
 *
 * 「止めろ」ではなく「自分は終わった」を放送する点は始まりと同じ — 再開するか
 * どうかは各 provider が自分の状態を見て決める。
 */
export function announceAudioRelease(owner: AudioOwner): void {
  announceAudioPhase(owner, "release");
}

/**
 * 「始まり」の放送だけを購読する。戻り値を呼ぶと購読を解除する。
 *
 * 拡張前と同じ形 (listener は owner だけを受け取る) のまま残してある。終わりの
 * 放送まで見たい購読者は `subscribeAudioPhase` を使う。
 */
export function subscribeAudioPlay(listener: Listener): () => void {
  return subscribeAudioPhase((owner, phase) => {
    if (phase === "start") listener(owner);
  });
}

/** 始まり・終わりの両方を購読する。戻り値を呼ぶと購読を解除する。 */
export function subscribeAudioPhase(listener: PhaseListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
