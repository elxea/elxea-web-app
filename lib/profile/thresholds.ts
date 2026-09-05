/**
 * roji プロファイル (ミクロ⇔マクロ) の匿名性・母集団状態のしきい値。
 *
 * 画面側にも API 側にも複製しない — この 1 ファイルだけを見れば全部の値が揃う
 * (Spec §「初期母集団とコールドスタート」)。
 *
 * 正本: Spec https://app.notion.com/p/3d270c9d064c8171b70be803150d6d5d (判断点 D6)。
 * 値そのもの (10 名 / 50 名) は Setaka 承認の推奨値 (D6) を既定にしている。
 */

/** これ未満は「みんな」の面を描かない (quiet)。D6。 */
export const PROFILE_MIN_COHORT = 10;

/** これ以上で等高線・共通語まで出す (formed)。 */
export const PROFILE_FORMED_COHORT = 50;

/**
 * ヒステリシス (QA 致命 2 — 時系列差分攻撃への対処)。
 *
 * 一度 sparse になったら実人数がこの人数を下回るまで quiet に戻さない。
 * 一度 formed になったら実人数がこの人数を下回るまで sparse に戻さない。
 * 境界をまたぐ 1 名の増減が `grid: null → 非null` に直結しないようにする。
 */
export const PROFILE_QUIET_REENTRY = PROFILE_MIN_COHORT - 3; // 7
export const PROFILE_SPARSE_REENTRY = PROFILE_FORMED_COHORT - 5; // 45

/** `cohort` は常にこの単位に丸めて返す (実数を返さない)。 */
export const PROFILE_COHORT_ROUND_UNIT = 10;

/** `words.personal` — bbox 内の該当者数がこれ未満なら空配列を返す (QA 致命1・D6と同じ閾値)。 */
export const PROFILE_WORDS_PERSONAL_MIN_SUBJECTS = 10;

/** `words.personal` の上限件数。 */
export const PROFILE_WORDS_PERSONAL_MAX_ITEMS = 200;

/**
 * 差分攻撃対策 (QA 2周目致命)。`field` を実際に再集計・再公開するのは、
 * 前回の公開から新規参加者が **この人数以上** 増減したときだけ。
 * これ未満の増減では公開物 (grid の中身・version) を一切変えない —
 * 変えると「前日版との差分」から単一の新規参加者の座標が復元できてしまう。
 * D6 (最小人数) と同じ 10 を使う (二重の定数を持たない)。
 * 正本: Spec 追記3 (2周目QA致命)。
 */
export const PROFILE_FIELD_KBATCH = PROFILE_MIN_COHORT;

/**
 * `bbox` の最小サイズ (正規化空間 -1..1 における一辺の長さ)。
 *
 * 極小 bbox で1人だけを孤立抽出する攻撃を防ぐため、これを下回る指定はサーバー
 * 側でクランプ拡張してから集計する (`lib/profile/words.ts#clampBboxToMinSize`)。
 */
export const PROFILE_MIN_BBOX_SIZE = 0.2;

/** 1 フレームに描く要素数の上限 (性能予算)。 */
export const PROFILE_FRAME_ELEMENT_BUDGET = 1_500;

/**
 * 1 フレームに描く「言葉」の上限。地の面 (密度格子) とは**別に**持つ。
 *
 * 予算を 1 本にして地と言葉で分け合うと、格子のセル数が多い倍率 (LOD micro は
 * 最大 96×64 = 6,144 セル) で地が先に予算を使い切り、**寄るほど言葉が消える**。
 * それは Setaka 確定要件「寄って消えるものはない。すべては分解されるだけ」と
 * 正面から反する落ち方なので、言葉の予算は地の解像度に左右されない。
 *
 * 語彙表の規模 (数十) に対しては実質的に効かない上限で、実データが桁で増えた
 * ときだけ効く安全弁。重なりの解消は間引きではなく
 * `lib/profile/labels.ts#placeLabels` が担う。
 */
export const PROFILE_WORDS_FRAME_BUDGET = 400;

/** 密度格子のセル数の上限 (LOD 表の上限値)。 */
export const PROFILE_GRID_CELL_BUDGET = 8_000;

/** 1 画面あたりのペイロード上限 (バイト)。 */
export const PROFILE_PAYLOAD_BYTE_BUDGET = 30_000;

export type ProfileFieldState = "quiet" | "sparse" | "formed";

/**
 * 母集団の実数 (丸め前) と直前状態から、ヒステリシス込みの状態を決める。
 *
 * `prevState` が無い (初回) ときは単純なしきい値判定になる。
 */
export function resolveFieldState(
  rawCohort: number,
  prevState: ProfileFieldState | null,
): ProfileFieldState {
  if (prevState === "formed") {
    if (rawCohort < PROFILE_SPARSE_REENTRY) {
      return rawCohort < PROFILE_QUIET_REENTRY ? "quiet" : "sparse";
    }
    return "formed";
  }
  if (prevState === "sparse") {
    if (rawCohort >= PROFILE_FORMED_COHORT) return "formed";
    if (rawCohort < PROFILE_QUIET_REENTRY) return "quiet";
    return "sparse";
  }
  // prevState === "quiet" または初回 (null)
  if (rawCohort >= PROFILE_FORMED_COHORT) return "formed";
  if (rawCohort >= PROFILE_MIN_COHORT) return "sparse";
  return "quiet";
}

/**
 * 母集団の実数を公開用に丸める。
 *
 * 閾値未満は常に 0 (実数を返すと「いま7人」が推測でき、次の1人が誰かを絞る
 * 手がかりになる)。閾値以上は 10 単位丸め。
 */
export function roundCohort(rawCohort: number): number {
  if (rawCohort < PROFILE_MIN_COHORT) return 0;
  return Math.round(rawCohort / PROFILE_COHORT_ROUND_UNIT) * PROFILE_COHORT_ROUND_UNIT;
}
