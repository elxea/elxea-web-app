/**
 * 「言葉の三層」の組み立て — 一般語・共通語・個人語。
 *
 * 画面を知らない純関数のみ (Vitest 対象)。試作の `midCentroid` / `relax`
 * (札の押しのけ) を移植し、言葉の束ねは語彙表 (`lib/profile/vocabulary.ts`)
 * への写像で行う (判断点 D9・機械要約はしない)。
 *
 * `personal` を組み立てる `buildPersonalWords` は、引用許可 (カルテ項目18) の
 * 仕組みが未実装のため常に空配列を返す。これは欠損ではなく正しい振る舞い
 * (QA 致命1 の是正・契約テストで固定する)。
 */

import { vocabularyFor, type VocabularyFacet } from "@/lib/profile/vocabulary";
import { zoomBandFromZ } from "@/lib/profile/field";
import { PROFILE_WORDS_PERSONAL_MIN_SUBJECTS, roundCohort } from "@/lib/profile/thresholds";
import type { ProfileWordPersonalSchema } from "@/lib/profile/contract";
import type { z } from "zod";

export function midCentroid(
  entries: readonly { x: number; y: number; weight: number }[],
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let t = 0;
  for (const e of entries) {
    x += e.x * e.weight;
    y += e.y * e.weight;
    t += e.weight;
  }
  if (t <= 0) return { x: 0, y: 0 };
  return { x: x / t, y: y / t };
}

/**
 * 札の押しのけ (1段の緩和) — 重なって読めないのを防ぐ。
 *
 * 純関数 (入力を書き換えない)。文字は横に長く縦に短いので、押しのけは
 * 横長の楕円で見る (試作 `relax` と同じ重み `4.2`)。
 */
export function relax<T extends { x: number; y: number }>(
  items: readonly T[],
  minD: number,
  passes = 3,
): T[] {
  const out = items.map((i) => ({ ...i }));
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        let dx = b.x - a.x;
        let dy = (b.y - a.y) * 4.2;
        let d = Math.hypot(dx, dy);
        if (d < 1e-6) {
          dx = i % 2 ? minD : -minD;
          dy = 0;
          d = minD;
        }
        if (d < minD) {
          const k = ((minD - d) / d) * 0.5;
          a.x -= dx * k;
          a.y -= (dy * k) / 4.2;
          b.x += dx * k;
          b.y += (dy * k) / 4.2;
        }
      }
    }
  }
  return out;
}

export interface WordsLayers {
  general: Array<{ text: string; x: number; y: number; weight: number }>;
  shared: Array<{ text: string; x: number; y: number; weight: number; cohort: number }>;
}

/** 言葉の層の深さ。細かさの段 `z` が上がるほど深くなる (層は増えるだけ)。 */
export type WordLayerDepth = 1 | 2 | 3;

/**
 * 細かさの段 `z` → 言葉の層の深さ。
 *
 * 「寄るほど語が細かい語に分解される (一般化された語 → より具体的な語)」を
 * 契約の側で表す唯一の場所。段が上がると層が**増える**だけで、一度出た層が
 * 消えることは無い (Setaka 確定要件「寄って消えるものはない。すべては分解
 * されるだけ」)。
 *
 *   - 1 (粗い) … 一般語だけ (象限の名)
 *   - 2 (中間) … + 共通語 (匿名・一般化された粒度。他者の具体的な言葉ではない)
 *   - 3 (細かい) … + 個人語。**個人語は常に呼び出し本人のものだけ**
 *     (`ProfileWordPersonalSchema` の doc comment。他者の個人語を返す経路は
 *     契約そのものに存在しない)。引用許可 (カルテ項目18) の仕組みが未実装の
 *     いまは 0 件で、仕組みが入った時点でこの段に現れる。
 *
 * z の帯分けは密度格子の LOD (`lib/profile/field.ts#zoomBandFromZ`) と同じ関数を
 * 使う — 「格子は細かくなったのに語は分解されない」段を作らないため。
 */
export function wordLayerDepth(z: number): WordLayerDepth {
  const band = zoomBandFromZ(z);
  if (band === "macro") return 1;
  if (band === "mid") return 2;
  return 3;
}

/**
 * 一般語・共通語レイヤーを組み立てる。
 *
 * 段1は語彙表 (固定レイアウト) をそのまま返す。実データの使われ方に応じた
 * 重みづけは段3の前提工事 (カルテ集計) を待つ。共通語は母集団が最小人数未満
 * (`PROFILE_WORDS_PERSONAL_MIN_SUBJECTS`) なら出さない (匿名性の閾値を共通語にも
 * 揃える)。加えて、粗い段 (`wordLayerDepth` = 1) では共通語をまだ出さない —
 * そこは共通語が一般語へ**束ねられている**段だから。
 */
export function buildWordsLayers(
  facet: VocabularyFacet,
  rawSubjectCount: number,
  z = 0,
): WordsLayers {
  const table = vocabularyFor(facet);
  const cohort = roundCohort(rawSubjectCount);
  const general = table.general.map((g) => ({ text: g.text, x: g.x, y: g.y, weight: 1 }));
  if (cohort < PROFILE_WORDS_PERSONAL_MIN_SUBJECTS || wordLayerDepth(z) < 2) {
    return { general, shared: [] };
  }
  const relaxed = relax(
    table.shared.map((s) => ({ text: s.text, x: s.x, y: s.y })),
    0.05,
  );
  const shared = relaxed.map((s) => ({ text: s.text, x: s.x, y: s.y, weight: 0.8, cohort }));
  return { general, shared };
}

export type PersonalWord = z.infer<typeof ProfileWordPersonalSchema>;

/**
 * `words.personal` を組み立てる。**常に呼び出し本人のものだけ** (契約に他者の
 * 個人語を返す経路が無い — `ProfileWordPersonalSchema` 参照)。
 *
 * 引用許可 (カルテ項目18) の仕組みが未実装なので、実装されるまで常に空配列を
 * 返す。呼び出し側はこの関数だけを呼べば、認証要否 (D6b) や bbox 内人数の下限
 * 判定より前に確実に空へ倒れる。
 *
 * `z` を受けるのは、最も細かい段 (`wordLayerDepth` = 3) でだけ個人語が現れる、
 * という層の順序をこの関数の側でも守るため。仕組みが入っても、粗い段に個人語が
 * 混ざることは無い。
 */
export function buildPersonalWords(z = 0): PersonalWord[] {
  if (wordLayerDepth(z) < 3) return [];
  return permittedOwnWords();
}

/**
 * 引用許可 (カルテ項目18) 済みの、**本人が書いた**言葉。
 *
 * フラグの実装が入るまでは常に空。空を返すことが正しい振る舞いで、契約テストが
 * それを固定している (Spec §「実データ契約」C)。
 */
function permittedOwnWords(): PersonalWord[] {
  return [];
}

/** bbox が最小サイズを下回っていたらクランプ拡張する (極小 bbox 攻撃対策)。 */
export function clampBboxToMinSize(
  bbox: readonly [number, number, number, number],
  minSize: number,
): [number, number, number, number] {
  let [x0, y0, x1, y1] = bbox;
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < minSize) {
    const cx = (x0 + x1) / 2;
    x0 = cx - minSize / 2;
    x1 = cx + minSize / 2;
  }
  if (h < minSize) {
    const cy = (y0 + y1) / 2;
    y0 = cy - minSize / 2;
    y1 = cy + minSize / 2;
  }
  return [x0, y0, x1, y1];
}
