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

/**
 * 一般語・共通語レイヤーを組み立てる。
 *
 * 段1は語彙表 (固定レイアウト) をそのまま返す。実データの使われ方に応じた
 * 重みづけは段3の前提工事 (カルテ集計) を待つ。共通語は母集団が最小人数未満
 * (`PROFILE_WORDS_PERSONAL_MIN_SUBJECTS`) なら出さない (匿名性の閾値を共通語にも
 * 揃える)。
 */
export function buildWordsLayers(facet: VocabularyFacet, rawSubjectCount: number): WordsLayers {
  const table = vocabularyFor(facet);
  const cohort = roundCohort(rawSubjectCount);
  const general = table.general.map((g) => ({ text: g.text, x: g.x, y: g.y, weight: 1 }));
  if (cohort < PROFILE_WORDS_PERSONAL_MIN_SUBJECTS) {
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
 * `words.personal` を組み立てる。
 *
 * 引用許可 (カルテ項目18) の仕組みが未実装なので、実装されるまで常に空配列を
 * 返す。呼び出し側 (`app/api/profile/words/route.ts`) はこの関数だけを呼べば、
 * 認証要否 (D6b) や bbox 内人数の下限判定より前に確実に空へ倒れる。
 */
export function buildPersonalWords(): PersonalWord[] {
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
