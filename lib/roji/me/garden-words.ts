/**
 * 「ことばの庭」— 自分が書いたことばのデータ層 (ダミー 3 面 × 15 件)。
 *
 * ## 商品ページの庭ではなく、自分のページの庭にした
 *
 * 原版 (viz 査定 `34-garden-interactive/lenses.js`) は **お客さんの感想**を
 * 商品 / 号 / イベントで絞って見せる庭だった。ここはマイページなので、
 * 置くのは **自分が書いた一言**に置き換えてある。詠み人 (`by`) と土地 (`where`) は
 * 全部「自分」になって意味を失うので落とし、代わりに **どこで書いたことばか**
 * (`source`) だけを持たせた。触れたときに浮かぶのはこの 1 行。
 *
 * ## レンズの名前
 *
 * 原版の「この商品の庭 / この号の庭 / このイベントの庭」は、見る人が
 * 商品ページ・号ページ・イベントページのどれに立っているかを言う名前だった。
 * マイページには立ち位置が 1 つしかないので、**ことばを書いた場面**で分ける
 * 名前に変えた ——「お茶によせて / 読みものによせて / 集まりによせて」。
 * 「〜の庭」を 3 つ並べると「庭」が 4 回出て題字と喧嘩する、というのが
 * 「によせて」を選んだ実務上の理由でもある。
 *
 * ## `TEA_CUPS.voice` を作り直さない
 *
 * 「お茶によせて」の 15 件は `lib/roji/me/tea-log.ts` の `voice`
 * (一杯ごとの自分の一言) をそのまま引いている。同じ性質のことばを別テーブルで
 * 二重に持つと、実データ接続のときに **どちらが正本か分からなくなる**。
 * 引くときの選び方は「短いもの」— 庭は 1 件 = 1 行で、長い文を大きくすると
 * 庭ではなく見出しになるため (下記「大きさの決め方」)。
 *
 * ## 折り返し位置 (budoux を入れていない理由)
 *
 * 原版は BudouX (Apache-2.0 / Google) で文節に割り、その境目にだけ `<wbr>` を
 * 置いていた。素の `word-break` に任せると「二 / 煎目」で切れて詩が壊れるため。
 * この repo に budoux は入っておらず、**この 1 枚のために依存を増やさない**
 * 判断をしたので、代わりに **文節割りをこの層が手で持つ** (`phrases`)。
 * 描画側は `phrases` の間にだけ `<wbr>` を置き、CSS は `word-break: keep-all` で
 * 「ここ以外では折らない」を作る。結果は同じで、辞書ぶんのバイトが乗らない。
 * budoux を入れられるようになったら `phrases` の生成を parser に置き換える
 * (型は変えなくてよい) —— これが本来の姿。
 *
 * ## 色を持たない層である (roji の色ルール)
 *
 * roji では **色はカテゴリー (緑茶 / 紅茶 / 青茶) を表す**。1 枚の図に並べてよいのは
 * 同じカテゴリーだけなので、1 枚に載る要素は全部同色になるのが正しい姿。
 * だからこの層は色を一切持たない —— ことばは墨の単色で書き、強弱は
 * **濃さと大きさだけ**で付ける。`lens` を色に写すような実装を描画側に足さないこと
 * (「お茶によせて = 緑」のような割り当ては、色の意味をカテゴリーから奪う)。
 * 「お茶によせて」の出典は `lib/roji/me/tea-log.ts` の履歴 (すべて緑茶) から引くので、
 * 1 面の中でカテゴリーが割れることもない。
 *
 * ## 差し替え契約 (実データが来たときに守るもの)
 *
 * `lib/roji/tea-flavor.ts` と同じ形。**描画側はデータの出どころを一切知らない**。
 * 実データ (記録アプリ / 投稿テーブル) が来たら `GARDEN_LENSES` の組み立てだけを
 * 差し替え、`components/viz/me/garden/*` には手を入れない。
 *
 * - `text` は 8〜18 字。これを超える文は庭に置けない (1 行で置けず、
 *   大きくすると版面が見出しに見える)。長い記録は要約するか、庭に出さない
 * - `phrases` は `join("") === text` が必ず成り立つこと。折り返し可能点の列であって
 *   表示用の分かち書きではない (画面には区切りが出ない)
 * - `source` は **どこで書いたことばか**。銘柄名 / 号 / 会の名前。触れたときだけ出る
 * - `weight` は 0..1。「いま読み返して、どれだけ自分に残っているか」。
 *   これだけが字の大小を決める。**日付でも文字数でもない**
 * - 1 面につき 大 2〜3 件 / 中 5〜6 件 / 小 6〜7 件。全部を中くらいにすると版面が濁る
 * - 画面に算用数字を出さない (roji 原則)。`source` に日付を入れるなら
 *   「神無月」「第七号」のような表記にする
 *
 * 出典: viz 査定 `verdicts.md` 第6ラウンド `34-garden-interactive`
 * (土台は 24-2「庭の飛び石」)。
 */

import { TEA_CUPS } from "@/lib/roji/me/tea-log";

/**
 * 字の大きさの 7 段 (px)。
 *
 * 連続値にすると「なんとなく全部違うサイズ」になって版面が濁るので、段を
 * 決め打ちして飛ばす。実際の描画では版面の広さに応じて一律に縮める。
 */
export const GARDEN_SIZE_SCALE: readonly number[] = [13, 16, 20, 26, 34, 46, 62];

/**
 * 長い文を大きくしない上限。
 *
 * 1 行の実測幅は おおよそ 文字数 × 文字サイズ × 1.1。62px を 20 字に当てると
 * 1360px になり、どんな版面でも庭ではなく見出しになる。
 */
function maxStepFor(length: number): number {
  if (length <= 8) return 6;
  if (length <= 11) return 5;
  if (length <= 14) return 4;
  if (length <= 18) return 3;
  return 2;
}

/** `weight` を 7 段に写し、字数で頭を押さえる。 */
export function gardenSizeStep(weight: number, text: string): number {
  const raw = Math.round(weight * (GARDEN_SIZE_SCALE.length - 1));
  return Math.max(0, Math.min(raw, maxStepFor([...text].length)));
}

/** どの場面で書いたことばか。 */
export type GardenLensKey = "tea" | "reading" | "gathering";

/** 庭に置く 1 件。 */
export interface GardenWord {
  /** 一意な鍵。実データでは記録の id になる。 */
  id: string;
  /** ことば本体。`phrases` を連結したもの。 */
  text: string;
  /**
   * 折り返し可能点で割った文節列。`join("") === text`。
   * 描画側はこの境目にだけ `<wbr>` を置く (budoux の代わり)。
   */
  phrases: readonly string[];
  /** どこで書いたことばか。触れたときだけ浮かぶ 1 行。 */
  source: string;
  /** 属する面。 */
  lens: GardenLensKey;
  /** 0..1。いま自分にどれだけ残っていることばか。字の大小の元。 */
  weight: number;
  /** `GARDEN_SIZE_SCALE` の添字 (0..6)。`weight` と字数から決まる。 */
  step: number;
}

/** 庭 1 面。 */
export interface GardenLens {
  key: GardenLensKey;
  /** 切替の柱に出す名前。字間は描画側の `letter-spacing` が空ける。 */
  label: string;
  /** 「いまどの庭を見ているか」の一行。 */
  caption: string;
  /**
   * 配置の種。**面ごとに変える**。同じ配置に別のことばが入ると
   * 「差し替え」に見えて、別の庭に見えない。
   */
  seed: number;
  words: readonly GardenWord[];
}

interface WordSeed {
  phrases: readonly string[];
  source: string;
  weight: number;
}

/**
 * 一杯の記録から 1 件を引く。
 *
 * 文節割りは手書きなので、`voice` が動くと割りが合わなくなる。そのときは
 * **割りを捨てて 1 かたまりに戻す** (折り返し可能点が消えるだけで、ことばは正しい)。
 * ここで throw すると、文言を直しただけでページが落ちる。
 */
function fromCup(index: number, phrases: readonly string[], weight: number): WordSeed {
  const cup = TEA_CUPS[index];
  return {
    phrases: phrases.join("") === cup.voice ? phrases : [cup.voice],
    source: `${cup.label} ／ ${cup.season}`,
    weight,
  };
}

function buildWords(lens: GardenLensKey, seeds: readonly WordSeed[]): readonly GardenWord[] {
  return seeds.map((seed) => {
    const text = seed.phrases.join("");
    return {
      id: `${lens}-${text}`,
      text,
      phrases: seed.phrases,
      source: seed.source,
      lens,
      weight: seed.weight,
      step: gardenSizeStep(seed.weight, text),
    } satisfies GardenWord;
  });
}

/** 飲んだ日に書いたことば。`TEA_CUPS.voice` から短いものを引く。 */
const TEA_SEEDS: readonly WordSeed[] = [
  fromCup(38, ["ゆっくり", "時間を", "とれた日"], 0.92),
  fromCup(22, ["旨味の", "芯が", "はっきり", "ある"], 0.86),
  fromCup(27, ["夜は", "やっぱり", "これに", "戻る"], 0.82),
  fromCup(7, ["二煎目の", "ほうが", "好きだと", "気づく"], 0.72),
  fromCup(34, ["淹れ方が", "ようやく", "安定して", "きた"], 0.68),
  fromCup(13, ["湯を", "ぬるく", "したら、", "角が", "取れた"], 0.64),
  fromCup(39, ["いまの", "ところ、", "これが", "自分の", "真ん中"], 0.58),
  fromCup(9, ["冷めて", "からの", "ほうが", "香りが", "分かる"], 0.54),
  fromCup(24, ["若い", "甘み。", "春の", "匂いが", "した"], 0.5),
  fromCup(29, ["水出しに", "してみた。", "角が", "丸くなる"], 0.4),
  fromCup(16, ["軽くて", "澄んでいる。", "朝に", "向く"], 0.36),
  fromCup(5, ["やっぱり", "ここに", "戻ってくる"], 0.32),
  fromCup(2, ["夜に", "飲んでも", "眠れる、と", "知った日"], 0.28),
  fromCup(33, ["来客。", "いちばん", "良いものを", "出した"], 0.22),
  fromCup(28, ["小さい", "茶碗で、", "少しずつ"], 0.08),
];

/** 読みものの余白に書いたことば。出典は号 / 記事。 */
const READING_SEEDS: readonly WordSeed[] = [
  { phrases: ["読み終えて", "湯を", "沸かした"], source: "roji 便り ／ 第七号", weight: 0.92 },
  { phrases: ["封を", "切る", "音まで", "お茶"], source: "roji 便り ／ 第七号", weight: 0.86 },
  { phrases: ["手紙を", "先に", "読んだ"], source: "roji 便り ／ 第五号", weight: 0.82 },
  { phrases: ["台所が", "茶の", "匂いに", "なった"], source: "roji 便り ／ 第六号", weight: 0.72 },
  { phrases: ["一日ぶんの", "静けさが", "届いた"], source: "roji 便り ／ 第七号", weight: 0.68 },
  { phrases: ["ふたつめの", "封は", "明日に"], source: "roji 便り ／ 第六号", weight: 0.64 },
  { phrases: ["焙じ茶の", "日の", "夕方は", "長い"], source: "読みもの ／ 火の入れかた", weight: 0.58 },
  { phrases: ["母の", "家の", "縁側を", "思い出した"], source: "読みもの ／ 縁側の茶", weight: 0.54 },
  { phrases: ["同じ茶が", "先月と", "違う", "顔を", "している"], source: "roji 便り ／ 第四号", weight: 0.5 },
  { phrases: ["若草の", "匂いが", "鼻の", "奥に", "残る"], source: "読みもの ／ 新芽のころ", weight: 0.4 },
  { phrases: ["湯冷ましを", "使う", "癖が", "ついた"], source: "読みもの ／ 湯の温度", weight: 0.36 },
  { phrases: ["読むと", "いうより、", "眺めて", "いた"], source: "roji 便り ／ 第三号", weight: 0.32 },
  { phrases: ["遠くで", "木の実が", "はぜた", "ような"], source: "読みもの ／ 火の入れかた", weight: 0.26 },
  { phrases: ["封を", "開ける", "前が", "いちばん", "長い"], source: "roji 便り ／ 第二号", weight: 0.2 },
  { phrases: ["積んだ", "ままの", "号が", "まだ", "二つ", "ある"], source: "roji 便り ／ 第一号", weight: 0.08 },
];

/** 茶会・集まりの帰りに書いたことば。出典は会の名前。 */
const GATHERING_SEEDS: readonly WordSeed[] = [
  { phrases: ["湯の", "音だけが", "続いた"], source: "谷戸の茶会 ／ 神無月", weight: 0.92 },
  { phrases: ["誰も", "急いで", "いない"], source: "谷戸の茶会 ／ 神無月", weight: 0.86 },
  { phrases: ["畳に", "座ると", "音が", "減る"], source: "谷戸の茶会 ／ 神無月", weight: 0.82 },
  { phrases: ["隣の", "人と", "同じ", "顔に", "なった"], source: "谷戸の茶会 ／ 神無月", weight: 0.72 },
  { phrases: ["帰り道で", "口の", "中が", "まだ", "甘い"], source: "谷戸の茶会 ／ 神無月", weight: 0.68 },
  { phrases: ["二杯目で", "肩の", "力が", "抜けた"], source: "朝の一服会 ／ 弥生", weight: 0.64 },
  { phrases: ["庭の", "光が", "茶碗に", "落ちて", "いた"], source: "谷戸の茶会 ／ 神無月", weight: 0.58 },
  { phrases: ["初めて", "会った", "人と", "黙って", "飲んだ"], source: "朝の一服会 ／ 弥生", weight: 0.54 },
  { phrases: ["器の", "重さを", "両手で", "覚えた"], source: "手びねりの会 ／ 水無月", weight: 0.5 },
  { phrases: ["話すことが", "なくても", "平気だった"], source: "朝の一服会 ／ 弥生", weight: 0.4 },
  { phrases: ["つくばいの", "水の", "音が", "遠かった"], source: "谷戸の茶会 ／ 神無月", weight: 0.36 },
  { phrases: ["外の", "雨が", "茶の", "匂いを", "濃くした"], source: "手びねりの会 ／ 水無月", weight: 0.32 },
  { phrases: ["障子の", "白が", "やわらかい", "日"], source: "谷戸の茶会 ／ 神無月", weight: 0.26 },
  { phrases: ["見送りの", "間も", "お茶の", "話を", "した"], source: "朝の一服会 ／ 弥生", weight: 0.2 },
  { phrases: ["名前は", "覚えて", "いない"], source: "手びねりの会 ／ 水無月", weight: 0.08 },
];

/**
 * 文脈レンズ 3 面。
 *
 * 顔ぶれは 3 面で重ならない。重なると切り替えたときに「同じことばが動いただけ」に
 * 見えて、別の庭に来た感じが出ない (原版の実測でも重なり 0 件にしてある)。
 */
export const GARDEN_LENSES: readonly GardenLens[] = [
  {
    key: "tea",
    label: "お茶によせて",
    caption: "飲 ん だ 日 に 書 い た こ と ば",
    seed: 20260816,
    words: buildWords("tea", TEA_SEEDS),
  },
  {
    key: "reading",
    label: "読みものによせて",
    caption: "読 み も の の 余 白 に 書 い た こ と ば",
    seed: 20260817,
    words: buildWords("reading", READING_SEEDS),
  },
  {
    key: "gathering",
    label: "集まりによせて",
    caption: "帰 り 道 に 書 い た こ と ば",
    seed: 20260818,
    words: buildWords("gathering", GATHERING_SEEDS),
  },
];

export const GARDEN_LENS_BY_KEY: Readonly<Record<GardenLensKey, GardenLens>> =
  Object.fromEntries(GARDEN_LENSES.map((lens) => [lens.key, lens])) as Record<
    GardenLensKey,
    GardenLens
  >;

/**
 * その版面に置く件数まで絞る。
 *
 * 原版は画面いっぱいの版面に 15 件を置けたが、ページの中に収まる枠ではそこまで
 * 入らない。**先頭から順に切ってはいけない**のがここの要点で、`words` は
 * `weight` の降順なので `slice(0, 8)` にすると **大きい石ばかり 8 件**になり、
 * 「大 / 中 / 小」で読ませるという庭の文法そのものが消える (狭い画面ほど、
 * いちばん壊れてほしくないところが壊れる)。
 *
 * そこで **等間隔に間引く**。両端 (いちばん大きい石といちばん小さい石) は必ず
 * 残るので、件数が減っても版面の段の関係は保たれる。
 */
export function visibleGardenWords(lens: GardenLens, limit: number): readonly GardenWord[] {
  const total = lens.words.length;
  if (limit >= total) return lens.words;
  if (limit <= 1) return lens.words.slice(0, Math.max(0, limit));
  return Array.from(
    { length: limit },
    (_, i) => lens.words[Math.round((i * (total - 1)) / (limit - 1))]
  );
}
