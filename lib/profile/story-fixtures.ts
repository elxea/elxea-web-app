/**
 * Storybook 視覚回帰用の決定的なシーン組み立て。
 *
 * `lib/profile/synthetic/**` (段1インフラの生成データ源) は `import "server-only"`
 * を持ち、本番の Route Handler だけが到達できる設計になっている
 * (`eslint.config.mjs` の `no-restricted-imports`)。Storybook の story はブラウザ
 * ビルドとして動くため `server-only` を経由できず、また story はそもそも
 * API route の fetch も行わない (決定的な静止画を作る用途のため)。
 *
 * よってこのファイルは、`lib/profile/field.ts` / `words.ts` / `tea-menu.ts`
 * (いずれも "server-only" を持たない純関数) だけを使って、固定 seed の
 * `ProfileScene` を組み立てる。roji プロファイルの実行時契約 (`ProfileSource`)
 * とは独立した「story 専用の見た目確認データ」であり、本番の生成データ混入防止
 * 5層防御の対象にはならない (Story はアプリの実行時バンドルに含まれない)。
 */

import { seededRandom } from "@/lib/viz/roji-viz-palette";
import { teaMenuForCategory } from "@/lib/profile/tea-menu";
import { aggTea, buildFieldGrid, tasteOf, type WeightedPoint } from "@/lib/profile/field";
import { buildPersonalWords, buildWordsLayers } from "@/lib/profile/words";
import { profileFieldBbox } from "@/lib/profile/framing";
import { vocabularyFor } from "@/lib/profile/vocabulary";
import type {
  ProfileFacet,
  ProfileFieldResponse,
  ProfileSelfResponse,
  ProfileWordsResponse,
  TeaCategory,
} from "@/lib/profile/contract";
import type { ProfileScene } from "@/components/viz/profile/renderer";

const STORY_SEED = 90210;
const STORY_POPULATION = 240;

function makeStoryTeaPoints(category: TeaCategory, count: number): WeightedPoint[] {
  const menu = teaMenuForCategory(category);
  if (menu.length === 0) return [];
  const rand = seededRandom(STORY_SEED + category.length);
  const out: WeightedPoint[] = [];
  for (let i = 0; i < count; i++) {
    const tea = menu[Math.floor(rand() * menu.length)];
    out.push({ x: tea.point.x + (rand() - 0.5) * 1.4, y: tea.point.y + (rand() - 0.5) * 1.4, w: 1 });
  }
  return out;
}

function makeStoryFacetPoints(facet: "reading" | "event", count: number): WeightedPoint[] {
  const table = vocabularyFor(facet);
  const anchors = table.shared.length ? table.shared : table.general;
  if (anchors.length === 0) return [];
  const rand = seededRandom(STORY_SEED + (facet === "reading" ? 1 : 2));
  const out: WeightedPoint[] = [];
  for (let i = 0; i < count; i++) {
    const a = anchors[Math.floor(rand() * anchors.length)];
    out.push({ x: a.x + (rand() - 0.5) * 0.3, y: a.y + (rand() - 0.5) * 0.3, w: 1 });
  }
  return out;
}

function buildStorySelf(category: TeaCategory): ProfileSelfResponse {
  const menu = teaMenuForCategory(category);
  const rand = seededRandom(STORY_SEED + 999);
  const items: WeightedPoint[] = [];
  const cups: Array<{ teaId: string; label: string; x: number; y: number; weight: number }> = [];
  for (let i = 0; i < 6 && menu.length > 0; i++) {
    const tea = menu[Math.floor(rand() * menu.length)];
    const weight = 0.5 + rand() * 0.5;
    items.push({ x: tea.point.x, y: tea.point.y, w: weight });
    cups.push({ teaId: tea.teaId, label: tea.label, x: tea.point.x, y: tea.point.y, weight });
  }
  const taste = tasteOf(items);
  const details = aggTea(cups);
  return {
    source: "synthetic",
    facet: "tea",
    category,
    centroid: taste ? { x: taste.x, y: taste.y } : null,
    spread: taste?.r ?? null,
    basis: { cups: items.length, teas: details.length, category },
    details,
    state: taste ? "ready" : "empty",
  };
}

/** 固定 seed の `ProfileScene` を1つ組み立てる。story だけが使う。 */
export function buildStoryScene(
  facet: ProfileFacet,
  category: TeaCategory | undefined,
  z: number,
): ProfileScene {
  const bbox = profileFieldBbox(facet);
  const points =
    facet === "tea"
      ? makeStoryTeaPoints(category ?? "green", STORY_POPULATION)
      : makeStoryFacetPoints(facet, STORY_POPULATION);
  const { publish: _publish, ...fieldResult } = buildFieldGrid({
    points,
    rawCohort: points.length,
    prevState: null,
    z,
    bbox,
  });
  const field: ProfileFieldResponse = {
    source: "synthetic",
    facet,
    category: facet === "tea" ? category : undefined,
    ...fieldResult,
  };

  const self = facet === "tea" ? buildStorySelf(category ?? "green") : null;

  let words: ProfileWordsResponse;
  if (facet === "tea") {
    words = { source: "synthetic", facet: "tea", category, general: [], shared: [], personal: [] };
  } else {
    const layers = buildWordsLayers(facet, STORY_POPULATION);
    words = {
      source: "synthetic",
      facet,
      general: layers.general,
      shared: layers.shared,
      personal: buildPersonalWords(),
    };
  }

  return { self, field, words };
}
