/**
 * 生成データ (架空の人) の生成器。
 *
 * 試作 `roji-r4-zoom-20260904.html` の `makeTeaPeople` の考え方を移植 — 決定的な
 * seed を持つので、同じ seed なら同じ絵になる (視覚回帰テストが成立する)。
 *
 * ## 到達不能化 (生成データ混入防止 5層防御・層1)
 *
 * このファイル (`lib/profile/synthetic/**`) を import できるのは
 * `lib/profile/source.ts` だけ。`eslint.config.mjs` の `no-restricted-imports`
 * で機械強制する。CI (`scripts/check-no-synthetic-in-prod-bundle.mjs`) は本番
 * ビルド成果物の server bundle に `SYNTHETIC_SEED_MARKER` の文字列が含まれて
 * いたら fail する。
 */

import "server-only";

import { seededRandom } from "@/lib/viz/roji-viz-palette";
import { teaMenuForCategory, type TeaMenuEntry } from "@/lib/profile/tea-menu";
import { tasteOf, aggTea, type WeightedPoint, type TeaAggEntry } from "@/lib/profile/field";
import { vocabularyFor, type VocabularyFacet } from "@/lib/profile/vocabulary";
import type { TeaCategory } from "@/lib/profile/contract";

/**
 * CI の混入検査が探す目印。この文字列が本番の server bundle に含まれていたら
 * `SyntheticSource` が本番のバンドルに巻き込まれている (fail)。
 */
export const SYNTHETIC_SEED_MARKER = "roji-profile-synthetic-v1";

const SEED_BASE = 20260905;

export interface SyntheticTeaPerson {
  x: number;
  y: number;
  r: number;
  items: TeaAggEntry[];
}

/** カテゴリー内の銘柄を index でクラスタ化する (試作 `CLUST` の考え方)。 */
function clusterIndexes(menu: readonly TeaMenuEntry[]): number[][] {
  const size = Math.max(2, Math.ceil(menu.length / 3));
  const clusters: number[][] = [];
  for (let i = 0; i < menu.length; i += size) {
    clusters.push(Array.from({ length: Math.min(size, menu.length - i) }, (_, k) => i + k));
  }
  return clusters.length ? clusters : [menu.map((_, i) => i)];
}

/** 傾向の偏りを持つ架空の人を作る (試作 `makeTeaPeople`)。決定的。 */
export function makeSyntheticTeaPeople(category: TeaCategory, count: number): SyntheticTeaPerson[] {
  const menu = teaMenuForCategory(category);
  if (menu.length === 0) return [];
  const rand = seededRandom(SEED_BASE + hashCategory(category));
  const clusters = clusterIndexes(menu);
  const people: SyntheticTeaPerson[] = [];

  for (let i = 0; i < count; i++) {
    const home = clusters[Math.floor(rand() * clusters.length)];
    const n = 3 + Math.floor(rand() * 6);
    const items: WeightedPoint[] = [];
    const cups: Array<{ teaId: string; label: string; x: number; y: number; weight: number }> = [];
    for (let j = 0; j < n; j++) {
      const idx = rand() < 0.74 ? home[Math.floor(rand() * home.length)] : Math.floor(rand() * menu.length);
      const tea = menu[idx];
      const weight = 0.35 + rand() * 0.75;
      items.push({ x: tea.point.x, y: tea.point.y, w: weight });
      cups.push({ teaId: tea.teaId, label: tea.label, x: tea.point.x, y: tea.point.y, weight });
    }
    const taste = tasteOf(items);
    if (!taste) continue;
    people.push({
      x: taste.x + (rand() - 0.5) * 0.3,
      y: taste.y + (rand() - 0.5) * 0.3,
      r: taste.r,
      items: aggTea(cups),
    });
  }
  return people;
}

function hashCategory(category: TeaCategory): number {
  let h = 0;
  for (let i = 0; i < category.length; i++) h = (h * 31 + category.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000;
}

export interface SyntheticFacetSubject {
  x: number;
  y: number;
}

/** 読み物・イベント面の架空の主体を語彙表の共通語の周りに散らす。決定的。 */
export function makeSyntheticFacetSubjects(facet: VocabularyFacet, count: number): SyntheticFacetSubject[] {
  const table = vocabularyFor(facet);
  const anchors = table.shared.length ? table.shared : table.general;
  if (anchors.length === 0) return [];
  const rand = seededRandom(SEED_BASE + (facet === "reading" ? 11 : 22));
  const out: SyntheticFacetSubject[] = [];
  for (let i = 0; i < count; i++) {
    const a = anchors[Math.floor(rand() * anchors.length)];
    out.push({ x: a.x + (rand() - 0.5) * 0.3, y: a.y + (rand() - 0.5) * 0.3 });
  }
  return out;
}
