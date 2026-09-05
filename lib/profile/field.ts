/**
 * 「みんなの場」の計算 — 密度の面・等高線の水準・格子の LOD 解決。
 *
 * 画面を知らない純関数のみ (Vitest 対象)。試作 `roji-r4-zoom-20260904.html` の
 * `tasteOf` / `aggTea` / `densityField` / `mergeR` / `mergeLevels` の考え方を
 * 移植しつつ、サーバー日次バッチで固定解像度の格子を1回だけ作る用途に合わせて
 * 簡略化してある (試作はクライアント側の world-fixed 連続ズーム用で、ここでは
 * 不要な複雑さ)。
 *
 * 正本: Spec §「描画アーキテクチャ」「実データ契約」。
 */

import type { ProfileFieldState, ProfileGrid } from "@/lib/profile/contract";
import {
  PROFILE_FIELD_KBATCH,
  PROFILE_GRID_CELL_BUDGET,
  resolveFieldState,
  roundCohort,
  type ProfileFieldState as ThresholdFieldState,
} from "@/lib/profile/thresholds";

export interface WeightedPoint {
  x: number;
  y: number;
  w: number;
}

/** 重心 + 広がり (試作 `tasteOf`)。空入力は null。 */
export function tasteOf(points: readonly WeightedPoint[]): { x: number; y: number; r: number } | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  let t = 0;
  for (const p of points) {
    x += p.x * p.w;
    y += p.y * p.w;
    t += p.w;
  }
  if (t <= 0) return null;
  x /= t;
  y /= t;
  let v = 0;
  for (const p of points) v += p.w * ((p.x - x) ** 2 + (p.y - y) ** 2);
  return { x, y, r: Math.sqrt(v / t) };
}

export interface TeaCupInput {
  teaId: string;
  label: string;
  x: number;
  y: number;
  weight: number;
}

export interface TeaAggEntry {
  teaId: string;
  label: string;
  x: number;
  y: number;
  weight: number;
}

/** 銘柄ごとに寄与を足し込み、最大値=1 に正規化する (試作 `aggTea`)。 */
export function aggTea(cups: readonly TeaCupInput[]): TeaAggEntry[] {
  const byTea = new Map<string, TeaAggEntry>();
  for (const c of cups) {
    const cur = byTea.get(c.teaId);
    if (cur) cur.weight += c.weight;
    else byTea.set(c.teaId, { teaId: c.teaId, label: c.label, x: c.x, y: c.y, weight: c.weight });
  }
  let max = 0;
  for (const e of byTea.values()) if (e.weight > max) max = e.weight;
  if (max <= 0) return [...byTea.values()];
  return [...byTea.values()].map((e) => ({ ...e, weight: e.weight / max }));
}

/* ------------------------------------------------------------------ *
 * LOD (格子の解像度) — 人数と倍率段で決める。固定 96×64 にしない
 * (QA 致命3・重大7)。Spec の LOD 表そのまま。
 * ------------------------------------------------------------------ */

export type ZoomBand = "macro" | "mid" | "micro";

/** カメラの倍率段 (10 の冪。0=×1) から LOD 表の帯へ写す。 */
export function zoomBandFromZ(z: number): ZoomBand {
  if (z <= 0) return "macro";
  if (z === 1) return "mid";
  return "micro";
}

export interface GridDims {
  w: number;
  h: number;
}

/** state × 倍率段 → 格子の目安 w×h (Spec の LOD 表)。quiet は null (格子なし)。 */
export function resolveGridDims(state: ProfileFieldState, band: ZoomBand): GridDims | null {
  if (state === "quiet") return null;
  if (state === "sparse") {
    return band === "macro" ? { w: 16, h: 12 } : { w: 32, h: 24 };
  }
  // formed
  if (band === "macro") return { w: 32, h: 24 };
  if (band === "mid") return { w: 64, h: 48 };
  return { w: 96, h: 64 };
}

/** セル数の上限 = min(8000, 丸め後cohort × 4)。上限を超えていたら縮める。 */
export function clampGridToBudget(dims: GridDims, roundedCohort: number): GridDims {
  const cellBudget = Math.min(PROFILE_GRID_CELL_BUDGET, Math.max(1, roundedCohort) * 4);
  let { w, h } = dims;
  let guard = 0;
  while (w * h > cellBudget && w > 1 && h > 1 && guard < 64) {
    w = Math.max(1, Math.round(w * 0.85));
    h = Math.max(1, Math.round(h * 0.85));
    guard++;
  }
  return { w, h };
}

/* ------------------------------------------------------------------ *
 * 密度の面 (格子への足し込み) — サーバー日次バッチが1回払うコスト。
 * クライアントは受け取り済みの格子を描くだけ (毎フレームではない・QA重大7)。
 * ------------------------------------------------------------------ */

/** bbox を w×h の格子へビン分けし、1段の箱ぼかし (簡易ガウス近似) を掛ける。 */
export function buildDensityGrid(
  points: readonly WeightedPoint[],
  bbox: readonly [number, number, number, number],
  w: number,
  h: number,
): Float32Array {
  const [x0, y0, x1, y1] = bbox;
  const grid = new Float32Array(w * h);
  const cellW = (x1 - x0) / w || 1;
  const cellH = (y1 - y0) / h || 1;
  for (const p of points) {
    const i = Math.min(w - 1, Math.max(0, Math.floor((p.x - x0) / cellW)));
    const j = Math.min(h - 1, Math.max(0, Math.floor((p.y - y0) / cellH)));
    grid[j * w + i] += p.w || 1;
  }
  return boxBlur(grid, w, h, 1);
}

function boxBlur(grid: Float32Array, w: number, h: number, radius: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let sum = 0;
      let n = 0;
      for (let dj = -radius; dj <= radius; dj++) {
        for (let di = -radius; di <= radius; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
          sum += grid[jj * w + ii];
          n++;
        }
      }
      out[j * w + i] = n ? sum / n : 0;
    }
  }
  return out;
}

/** 0..1 (Float32) → 0..255 (Uint8) に正規化する。全ゼロなら全て0。 */
export function quantizeGridToU8(grid: Float32Array): Uint8Array {
  let max = 0;
  for (const v of grid) if (v > max) max = v;
  const out = new Uint8Array(grid.length);
  if (max <= 0) return out;
  for (let i = 0; i < grid.length; i++) out[i] = Math.round((grid[i] / max) * 255);
  return out;
}

/**
 * セル値を10単位へ丸める (差分攻撃対策・QA 2周目致命)。
 *
 * 版が変わったとき (`decideFieldPublish` が実際に再公開したとき) でも、
 * 1人ぶんの寄与がセル値にそのまま出ると「前版との差分」が新規参加者の
 * 座標を教える経路になる。0..255 を10刻みへ量子化し、セル1つあたりの
 * 実効的な情報量を落とす。丸め後も 0..255 に収まる。
 */
export function roundU8ToUnits(u8: Uint8Array, unit = 10): Uint8Array {
  const out = new Uint8Array(u8.length);
  for (let i = 0; i < u8.length; i++) {
    out[i] = Math.min(255, Math.round(u8[i] / unit) * unit);
  }
  return out;
}

/**
 * `Uint8Array` → base64。Node (`Buffer`) とブラウザ (`btoa`) の両対応 —
 * 段1インフラの唯一の呼び出し元は Route Handler (Node) だが、
 * `lib/profile/story-fixtures.ts` (Storybook・ブラウザ実行) もこの関数を
 * 経由するため、どちらの環境でも動く必要がある
 * (`components/viz/profile/renderers/canvas/index.ts#decodeGrid` と対の実装)。
 */
function encodeU8ToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

/** 等高線の水準 (0..1 の正規化割合)。quiet/sparse は引かない (試作の判断を踏襲)。 */
export function contourLevelsFor(state: ProfileFieldState): number[] {
  if (state !== "formed") return [];
  return [0.35, 0.62];
}

/* ------------------------------------------------------------------ *
 * 公開版の管理 (差分攻撃対策・QA 2周目致命)
 *
 * 「前回公開から新規k=10名以上増減したときだけ再集計・公開」+「版番号」で、
 * 旧版との差分から単一の新規参加者の座標を復元できないようにする。
 * セル値の10単位丸めと組み合わせて三重に守る (Spec 追記3)。
 * ------------------------------------------------------------------ */

/** ある時点で「公開されていた」内容のスナップショット。次回呼び出しの基準点になる。 */
export interface FieldPublishSnapshot {
  /** 実際に再集計・再公開するたびに +1。据え置き (frozen) では変わらない。 */
  version: number;
  /** この版が実際に計算された ISO 日時。据え置きでは変わらない。 */
  publishedAt: string;
  /** この版を計算したときの実人数 (丸め前)。次回の k 判定の基準点。 */
  publishedRawCohort: number;
  state: ThresholdFieldState;
  cohort: number;
  grid: ProfileGrid | null;
  levels: number[];
}

/**
 * 前回の公開スナップショットと現在の実データから、公開版を決める純関数。
 *
 * - 初回 (`previous` が無い) は必ず公開する。
 * - `quiet`⇄`sparse`⇄`formed` の状態遷移 (既存のヒステリシスを経て確定した
 *   もの) が起きたときは、内容を state に追随させる必要があるので必ず公開する。
 * - それ以外は、前回公開からの実人数の増減が `kBatch` 未満なら**内容を一切
 *   変えず前回のスナップショットをそのまま返す**。基準点 (`publishedRawCohort`)
 *   も動かさない — 動かすと少数の増分を気付かれずに積み上げられる
 *   (サラミ攻撃) ため。
 */
export function decideFieldPublish(params: {
  points: readonly WeightedPoint[];
  rawCohort: number;
  z: number;
  bbox: readonly [number, number, number, number];
  previous: FieldPublishSnapshot | null;
  /** `previous` が無い最初の呼び出しでも、直前の state だけは分かっている場合に渡す。 */
  prevState?: ThresholdFieldState | null;
  now?: string;
  kBatch?: number;
}): FieldPublishSnapshot {
  const kBatch = params.kBatch ?? PROFILE_FIELD_KBATCH;
  const previous = params.previous;
  const now = params.now ?? new Date().toISOString();

  const state = resolveFieldState(params.rawCohort, previous?.state ?? params.prevState ?? null);
  const cohort = roundCohort(params.rawCohort);

  const isFirstPublish = !previous;
  const stateChanged = previous ? previous.state !== state : true;
  const newSinceLastPublish = previous ? Math.abs(params.rawCohort - previous.publishedRawCohort) : Infinity;
  const shouldRepublish = isFirstPublish || stateChanged || newSinceLastPublish >= kBatch;

  if (!shouldRepublish && previous) {
    // 据え置き: 版・中身・基準点のすべてを変えない。
    return previous;
  }

  const nextVersion = (previous?.version ?? 0) + 1;

  if (state === "quiet") {
    return {
      version: nextVersion,
      publishedAt: now,
      publishedRawCohort: params.rawCohort,
      state,
      cohort,
      grid: null,
      levels: [],
    };
  }

  const band = zoomBandFromZ(params.z);
  const rawDims = resolveGridDims(state, band);
  if (!rawDims) {
    return {
      version: nextVersion,
      publishedAt: now,
      publishedRawCohort: params.rawCohort,
      state,
      cohort,
      grid: null,
      levels: [],
    };
  }
  const dims = clampGridToBudget(rawDims, cohort);
  const density = buildDensityGrid(params.points, params.bbox, dims.w, dims.h);
  const u8 = roundU8ToUnits(quantizeGridToU8(density));
  const data = encodeU8ToBase64(u8);
  const grid: ProfileGrid = { w: dims.w, h: dims.h, enc: "u8", data, z: params.z };
  return {
    version: nextVersion,
    publishedAt: now,
    publishedRawCohort: params.rawCohort,
    state,
    cohort,
    grid,
    levels: contourLevelsFor(state),
  };
}

/* ------------------------------------------------------------------ *
 * 3本のうち B (field) の中身をまとめて組み立てる。
 * ------------------------------------------------------------------ */

export interface FieldGridResult {
  state: ThresholdFieldState;
  cohort: number;
  grid: ProfileGrid | null;
  levels: number[];
  bbox: [number, number, number, number];
  version: number;
  publishedAt: string;
  kBatch: number;
  /**
   * 次回呼び出しのために `FieldPublishStore` へ保存するスナップショット。
   * API 応答 (`ProfileFieldResponse`) には含めない — 呼び出し側はこのフィールド
   * を除いた残りを spread すること (`const { publish, ...response } = result`)。
   */
  publish: FieldPublishSnapshot;
}

export interface BuildFieldGridParams {
  points: readonly WeightedPoint[];
  rawCohort: number;
  prevState: ThresholdFieldState | null;
  z: number;
  bbox: [number, number, number, number];
  /** 差分攻撃対策の基準点。渡さなければ「初回公開」として必ず再集計する。 */
  previousPublish?: FieldPublishSnapshot | null;
  now?: string;
  kBatch?: number;
}

/**
 * サーバー日次バッチが1回計算する `field` の中身。
 *
 * `LiveSource` / `SyntheticSource` の両方がこの関数だけを呼ぶ (同じ経路)。
 * 差分攻撃対策 (公開判定・版番号・セル値丸め) は `decideFieldPublish` に
 * 委ね、ここは呼び出しの型を契約 (`ProfileFieldResponse`) に合わせるだけ。
 */
export function buildFieldGrid(params: BuildFieldGridParams): FieldGridResult {
  const kBatch = params.kBatch ?? PROFILE_FIELD_KBATCH;
  const snapshot = decideFieldPublish({
    points: params.points,
    rawCohort: params.rawCohort,
    z: params.z,
    bbox: params.bbox,
    previous: params.previousPublish ?? null,
    prevState: params.prevState,
    now: params.now,
    kBatch,
  });
  return {
    state: snapshot.state,
    cohort: snapshot.cohort,
    grid: snapshot.grid,
    levels: snapshot.levels,
    bbox: params.bbox,
    version: snapshot.version,
    publishedAt: snapshot.publishedAt,
    kBatch,
    publish: snapshot,
  };
}

/* ------------------------------------------------------------------ *
 * 公開スナップショットの置き場 (`FieldPublishStore`)。
 *
 * 「前回公開から何人増えたか」を比べるには、前回の公開を覚えておく場所が
 * 要る。本番の実データ経路 (D11: cx-agent 側の日次バッチ) は Supabase/KV
 * 等に永続化する想定だが、その実装は本 PR の範囲外 (別タスク)。ここでは
 * `LiveSource` / `SyntheticSource` の両方が同じインターフェースを通す形
 * だけを用意し、既定はプロセス内メモリ実装にする。
 *
 * **既知の限界**: メモリ実装はプロセス再起動・複数インスタンスをまたいで
 * 一貫性を保証しない。サーバーレス環境ではリクエストのたびに新しいプロセス
 * が立つことがあり、その場合は毎回「初回公開」扱いになる (安全側 — 公開判定を
 * 誤ってスキップして情報を隠しすぎる方向にしか倒れない。誤って公開しすぎる
 * 方向には倒れない)。永続化は D11 の一部として別途実装する。
 */
export interface FieldPublishStore {
  get(key: string): Promise<FieldPublishSnapshot | null>;
  set(key: string, snapshot: FieldPublishSnapshot): Promise<void>;
}

/** `field` の公開状態を束ねる鍵。カメラの倍率段 (z) はキーに含めない —
 *  公開してよいかどうかの判定は母集団の増減だけで決まり、LOD (z) は
 *  同じ版の中で解像度が変わるだけの表示上の違いのため。 */
export function fieldPublishKey(facet: string, category: string | undefined): string {
  return `${facet}:${category ?? "-"}`;
}

export class InMemoryFieldPublishStore implements FieldPublishStore {
  private readonly snapshots = new Map<string, FieldPublishSnapshot>();

  async get(key: string): Promise<FieldPublishSnapshot | null> {
    return this.snapshots.get(key) ?? null;
  }

  async set(key: string, snapshot: FieldPublishSnapshot): Promise<void> {
    this.snapshots.set(key, snapshot);
  }
}
