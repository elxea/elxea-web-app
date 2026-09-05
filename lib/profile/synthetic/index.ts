/**
 * `PROFILE_DATA_SOURCE=synthetic` のときに使う `ProfileSource` 実装。
 *
 * 決定的な seed の架空データを返す。本番からは `lib/profile/source.ts` の
 * fail-closed 検査で到達できない。到達不能化・混入防止の詳細は
 * `lib/profile/synthetic/generators.ts` の冒頭コメント参照。
 */

import "server-only";

import type { ProfileSource } from "@/lib/profile/source";
import type {
  ProfileFieldParams,
  ProfileFieldResponse,
  ProfileSelfParams,
  ProfileSelfResponse,
  ProfileWordsParams,
  ProfileWordsResponse,
} from "@/lib/profile/contract";
import {
  aggTea,
  buildFieldGrid,
  fieldPublishKey,
  tasteOf,
  InMemoryFieldPublishStore,
  type FieldPublishStore,
  type WeightedPoint,
} from "@/lib/profile/field";
import { profileFieldBbox } from "@/lib/profile/framing";
import { buildPersonalWords, buildWordsLayers } from "@/lib/profile/words";
import { teaMenuForCategory } from "@/lib/profile/tea-menu";
import { makeSyntheticFacetSubjects, makeSyntheticTeaPeople } from "@/lib/profile/synthetic/generators";
import { seededRandom } from "@/lib/viz/roji-viz-palette";

/** 段1の動作確認用に固定した合成母集団の規模 (formed 帯を試作で見せるため50超)。 */
const SYNTHETIC_POPULATION = 240;
const SELF_SEED = 424242;

export class SyntheticSource implements ProfileSource {
  readonly kind = "synthetic" as const;

  /**
   * 差分攻撃対策 (公開判定・版番号) の基準点を覚える場所。既定はインスタンス
   * ごとに新しいメモリ実装 — テスト・story がそれぞれ独立した「初回公開」から
   * 始められるようにするため (`lib/profile/field.ts#InMemoryFieldPublishStore`
   * の doc comment に既知の限界を記載)。
   */
  constructor(private readonly publishStore: FieldPublishStore = new InMemoryFieldPublishStore()) {}

  async getSelf(params: ProfileSelfParams): Promise<ProfileSelfResponse> {
    const menu = teaMenuForCategory(params.category);
    if (menu.length === 0) {
      return {
        source: "synthetic",
        facet: "tea",
        category: params.category,
        centroid: null,
        spread: null,
        basis: { cups: 0, teas: 0, category: params.category },
        details: [],
        state: "empty",
      };
    }
    const rand = seededRandom(SELF_SEED);
    const n = 5 + Math.floor(rand() * 4);
    const items: WeightedPoint[] = [];
    const cups: Array<{ teaId: string; label: string; x: number; y: number; weight: number }> = [];
    for (let i = 0; i < n; i++) {
      const tea = menu[Math.floor(rand() * menu.length)];
      const weight = 0.4 + rand() * 0.6;
      items.push({ x: tea.point.x, y: tea.point.y, w: weight });
      cups.push({ teaId: tea.teaId, label: tea.label, x: tea.point.x, y: tea.point.y, weight });
    }
    const taste = tasteOf(items);
    const details = aggTea(cups);
    return {
      source: "synthetic",
      facet: "tea",
      category: params.category,
      centroid: taste ? { x: taste.x, y: taste.y } : null,
      spread: taste?.r ?? null,
      basis: { cups: n, teas: details.length, category: params.category },
      details,
      state: taste ? "ready" : "empty",
    };
  }

  async getField(params: ProfileFieldParams): Promise<ProfileFieldResponse> {
    const bbox = profileFieldBbox(params.facet);
    const key = fieldPublishKey(params.facet, params.category);
    const previousPublish = await this.publishStore.get(key);

    let points: WeightedPoint[];
    let category: ProfileFieldResponse["category"] = undefined;
    if (params.facet === "tea") {
      category = params.category ?? "green";
      const people = makeSyntheticTeaPeople(category, SYNTHETIC_POPULATION);
      points = people.map((p) => ({ x: p.x, y: p.y, w: 1 }));
    } else {
      const subjects = makeSyntheticFacetSubjects(params.facet, SYNTHETIC_POPULATION);
      points = subjects.map((s) => ({ x: s.x, y: s.y, w: 1 }));
    }

    const { publish, ...response } = buildFieldGrid({
      points,
      rawCohort: points.length,
      prevState: previousPublish?.state ?? null,
      z: params.z,
      bbox,
      previousPublish,
    });
    await this.publishStore.set(key, publish);
    return { source: "synthetic", facet: params.facet, category, ...response };
  }

  async getWords(params: ProfileWordsParams): Promise<ProfileWordsResponse> {
    if (params.facet === "tea") {
      // お茶の言葉は段1の対象外 (実データ層 lib/roji/me/garden-words.ts 経由の想定)。
      return {
        source: "synthetic",
        facet: "tea",
        category: params.category,
        general: [],
        shared: [],
        personal: [],
      };
    }
    const layers = buildWordsLayers(params.facet, SYNTHETIC_POPULATION);
    return {
      source: "synthetic",
      facet: params.facet,
      general: layers.general,
      shared: layers.shared,
      // 引用許可の仕組みが未実装のため常に空 (D6/QA致命1)。synthetic でも本番と
      // 同じ振る舞いにしておくことで、視覚回帰 story が個人語の有無で分岐しない。
      personal: buildPersonalWords(),
    };
  }
}
