/**
 * 言葉の三層 (個人語 → 共通語 → 一般語) の束ね表。
 *
 * 個人の一文を共通語へ、共通語を一般語へ束ねる作業は、機械の自動要約ではなく
 * **運営が持つこの表への写像**で行う (判断点 D9)。要約が誤ると匿名の一文が
 * 別人の主張に見えるため。表の置き場はこのファイルが正本で、Notion への複製は
 * しない。
 *
 * `facet` は `reading` (読み物) / `event` (イベント) の 2 つ (`tea` の言葉は
 * 別途 `lib/roji/me/garden-words.ts` の実データ層を経由する想定で、本表の対象外)。
 *
 * `general` は最上位の一般語 (象限の名。図の外枠・凡例には出さず、地の上に薄く
 * 置く語)。`shared` は一般語1件にぶら下がる中位の共通語。座標は -1..1 の
 * 正規化空間で、`x`/`y` は象限の目安位置 (実データが増えたら重心計算に置き換える
 * 想定・段1では固定レイアウト)。
 *
 * 段1は生成データでの動作確認が目的のため、件数は試作 (`roji-r4-zoom-20260904.html`
 * の `FIELDS`) より絞ってある。段2以降、実データ・実フレーズに合わせて増補する。
 */

export type VocabularyFacet = "reading" | "event";

export interface VocabularyGeneralEntry {
  /** 一般語 (象限の名)。 */
  text: string;
  x: number;
  y: number;
}

export interface VocabularySharedEntry {
  /** 共通語。 */
  text: string;
  x: number;
  y: number;
  /** ぶら下がる一般語の index (`general` 配列の添字)。 */
  generalIndex: number;
}

export interface VocabularyTable {
  general: readonly VocabularyGeneralEntry[];
  shared: readonly VocabularySharedEntry[];
}

const READING_TABLE: VocabularyTable = {
  general: [
    { text: "火 と 焙 じ", x: -0.72, y: -0.55 },
    { text: "香 り", x: -0.2, y: -0.78 },
    { text: "台 所", x: 0.3, y: -0.3 },
    { text: "読 む 時 間", x: 0.72, y: -0.1 },
    { text: "手 紙", x: 0.55, y: 0.55 },
    { text: "静 け さ", x: -0.1, y: 0.62 },
  ],
  shared: [
    { text: "火の入れかた", x: -0.86, y: -0.7, generalIndex: 0 },
    { text: "焙じ茶の夕方", x: -0.58, y: -0.44, generalIndex: 0 },
    { text: "若草の匂い", x: -0.34, y: -0.92, generalIndex: 1 },
    { text: "鼻の奥に残る", x: -0.06, y: -0.66, generalIndex: 1 },
    { text: "湯を沸かす", x: 0.16, y: -0.44, generalIndex: 2 },
    { text: "茶の匂いになる", x: 0.44, y: -0.42, generalIndex: 2 },
    { text: "読み終えて", x: 0.86, y: -0.26, generalIndex: 3 },
    { text: "積んだままの号", x: 0.88, y: 0.06, generalIndex: 3 },
    { text: "封を切る", x: 0.42, y: 0.42, generalIndex: 4 },
    { text: "先に読んだ手紙", x: 0.7, y: 0.7, generalIndex: 4 },
    { text: "一日ぶんの静けさ", x: -0.24, y: 0.5, generalIndex: 5 },
    { text: "眺めるだけの時間", x: 0.06, y: 0.76, generalIndex: 5 },
  ],
};

const EVENT_TABLE: VocabularyTable = {
  general: [
    { text: "静 け さ", x: -0.15, y: -0.8 },
    { text: "湯 の 音", x: -0.7, y: -0.5 },
    { text: "座 る", x: -0.8, y: 0.1 },
    { text: "初 め て", x: 0.35, y: -0.6 },
    { text: "黙 る", x: 0.72, y: -0.3 },
    { text: "手 の 記 憶", x: -0.55, y: 0.7 },
  ],
  shared: [
    { text: "湯の音だけ", x: -0.86, y: -0.62, generalIndex: 1 },
    { text: "つくばいの水", x: -0.6, y: -0.72, generalIndex: 1 },
    { text: "誰も急いでいない", x: -0.28, y: -0.94, generalIndex: 0 },
    { text: "音が減る", x: -0.02, y: -0.62, generalIndex: 0 },
    { text: "初めて会った人", x: 0.28, y: -0.42, generalIndex: 3 },
    { text: "隣の人と同じ顔", x: 0.52, y: -0.72, generalIndex: 3 },
    { text: "黙って飲んだ", x: 0.86, y: -0.46, generalIndex: 4 },
    { text: "話すことがなくても", x: 0.66, y: -0.1, generalIndex: 4 },
    { text: "畳に座る", x: -0.92, y: 0.2, generalIndex: 2 },
    { text: "器の重さ", x: -0.66, y: 0.52, generalIndex: 5 },
    { text: "名前は覚えていない", x: -0.4, y: 0.86, generalIndex: 5 },
  ],
};

const TABLES: Record<VocabularyFacet, VocabularyTable> = {
  reading: READING_TABLE,
  event: EVENT_TABLE,
};

export function vocabularyFor(facet: VocabularyFacet): VocabularyTable {
  return TABLES[facet];
}
