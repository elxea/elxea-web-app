/**
 * roji プロファイル (ミクロ⇔マクロ) の 3 本の GET が満たす契約。
 *
 * `LiveSource` と `SyntheticSource` はこのスキーマを **同一に** 満たす
 * (契約テストで parity を検査する)。API route はこのファイルの型・スキーマ
 * だけに依存し、値の出どころ (`lib/profile/source.ts`) を知らない。
 *
 * 正本: Spec https://app.notion.com/p/3d270c9d064c8171b70be803150d6d5d §3。
 */

import { z } from "zod";

export const ProfileFacetSchema = z.enum(["tea", "reading", "event"]);
export type ProfileFacet = z.infer<typeof ProfileFacetSchema>;

/** D7 (恒久ルール): `tea` は必ずカテゴリー単位。カテゴリーを跨いだ集計は返さない。 */
export const TeaCategorySchema = z.enum(["green", "red", "oolong"]);
export type TeaCategory = z.infer<typeof TeaCategorySchema>;

export const ProfileSourceKindSchema = z.enum(["live", "synthetic"]);
export type ProfileSourceKind = z.infer<typeof ProfileSourceKindSchema>;

/* ---------------------------------------------------------------------- *
 * A. GET /api/profile/self
 * ---------------------------------------------------------------------- */

export const ProfileSelfStateSchema = z.enum(["empty", "thin", "ready"]);
export type ProfileSelfState = z.infer<typeof ProfileSelfStateSchema>;

export const ProfileSelfDetailSchema = z.object({
  teaId: z.string(),
  label: z.string(),
  weight: z.number(),
  x: z.number(),
  y: z.number(),
});

export const ProfileSelfResponseSchema = z.object({
  source: ProfileSourceKindSchema,
  facet: z.literal("tea"),
  category: TeaCategorySchema,
  centroid: z.object({ x: z.number(), y: z.number() }).nullable(),
  spread: z.number().nullable(),
  basis: z.object({
    cups: z.number().int().nonnegative(),
    teas: z.number().int().nonnegative(),
    category: TeaCategorySchema,
  }),
  details: z.array(ProfileSelfDetailSchema),
  state: ProfileSelfStateSchema,
});
export type ProfileSelfResponse = z.infer<typeof ProfileSelfResponseSchema>;

/* ---------------------------------------------------------------------- *
 * B. GET /api/profile/field
 * ---------------------------------------------------------------------- */

export const ProfileFieldStateSchema = z.enum(["quiet", "sparse", "formed"]);
export type ProfileFieldState = z.infer<typeof ProfileFieldStateSchema>;

export const ProfileGridSchema = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  enc: z.literal("u8"),
  /** base64 (u8 各セル 0..255 に正規化)。 */
  data: z.string(),
  z: z.number(),
});
export type ProfileGrid = z.infer<typeof ProfileGridSchema>;

export const ProfileFieldResponseSchema = z.object({
  source: ProfileSourceKindSchema,
  facet: ProfileFacetSchema,
  category: TeaCategorySchema.optional(),
  state: ProfileFieldStateSchema,
  /** 母集団の人数を10単位に丸めた値。閾値未満は 0。 */
  cohort: z.number().int().nonnegative(),
  grid: ProfileGridSchema.nullable(),
  levels: z.array(z.number()),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /**
   * 差分攻撃対策 (QA 2周目致命)。実際に再集計・再公開するたびに +1 する
   * 版番号。前回公開から新規参加者が `kBatch` 未満しか増減していないときは
   * `grid` の中身と一緒にこの値も据え置く — 版番号が変わらない2つの応答は
   * 中身も完全に同一であることを保証し、旧版との差分に意味を持たせない。
   */
  version: z.number().int().nonnegative(),
  /** `version` が最後に上がった (実際に再集計・再公開した) ISO 日時。 */
  publishedAt: z.string(),
  /**
   * 再公開に必要な新規参加者数のしきい値 (定数・現在 10)。**進捗 (あと何人)
   * は返さない** — 進捗を返すと実人数の増減が漏れ、丸め・据え置きで隠した
   * 情報が別経路で漏れる。
   */
  kBatch: z.number().int().positive(),
});
export type ProfileFieldResponse = z.infer<typeof ProfileFieldResponseSchema>;

/* ---------------------------------------------------------------------- *
 * C. GET /api/profile/words
 * ---------------------------------------------------------------------- */

export const ProfileWordGeneralSchema = z.object({
  text: z.string(),
  x: z.number(),
  y: z.number(),
  weight: z.number(),
});

export const ProfileWordSharedSchema = z.object({
  text: z.string(),
  x: z.number(),
  y: z.number(),
  weight: z.number(),
  /** 10単位丸め。丸め後が最小人数未満なら項目自体を返さない。 */
  cohort: z.number().int().nonnegative(),
});

/**
 * `personal` に載る一件。**常に呼び出し本人が書いたものだけ** (Setaka決定
 * 2026-09-05・反論なし。Decision Log
 * https://app.notion.com/p/3d270c9d064c81139c05e51c73d374ac — 「他者のコメントが
 * 見えるのはプライバシー上問題。俯瞰したときに見えるのは匿名化・一般化された
 * 粒度 (= `general`/`shared`) だけ」)。他者の個人語をこの契約で返す経路は
 * 存在しない。旧版にあった `mine: boolean` は「他者のものも返り得る」ことを
 * 前提にした設計だったため削除した — 型そのものが「これは常に自分のもの」を
 * 表す。
 */
export const ProfileWordPersonalSchema = z.object({
  id: z.string(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
});

export const ProfileWordsResponseSchema = z.object({
  source: ProfileSourceKindSchema,
  facet: ProfileFacetSchema,
  category: TeaCategorySchema.optional(),
  general: z.array(ProfileWordGeneralSchema),
  shared: z.array(ProfileWordSharedSchema),
  /**
   * 呼び出し本人が書いた言葉のみ (他者の個人語は契約から除外・上記
   * `ProfileWordPersonalSchema` 参照)。引用許可の仕組みも未実装のため、
   * 実装されるまで常に空配列 (正しい振る舞い)。
   */
  personal: z.array(ProfileWordPersonalSchema),
});
export type ProfileWordsResponse = z.infer<typeof ProfileWordsResponseSchema>;

/* ---------------------------------------------------------------------- *
 * リクエストパラメータ
 * ---------------------------------------------------------------------- */

export interface ProfileSelfParams {
  facet: "tea";
  category: TeaCategory;
  /** サーバー側で解決した本人の userKey。API route が requireAuth() から渡す。 */
  userKey: string;
}

export interface ProfileFieldParams {
  facet: ProfileFacet;
  category?: TeaCategory;
  /**
   * 細かさの段 (0 = 最も粗い / 2 = 最も細かい)。**拡大率ではない** —
   * 密度格子の解像度 (LOD 表) と等値線の段数を決める
   * (`components/viz/profile/camera.ts` の冒頭参照)。
   */
  z: number;
}

export interface ProfileWordsParams {
  facet: ProfileFacet;
  category?: TeaCategory;
  bbox: readonly [number, number, number, number];
  /**
   * 細かさの段 (0=粗い / 2=細かい)。どの層まで分解して返すかを決める
   * (`lib/profile/words.ts#wordLayerDepth`)。`field` の `z` と同じ意味。
   */
  z: number;
  /** 認証済みなら userKey (D6b: personal は認証必須が既定)。 */
  userKey: string | null;
}
