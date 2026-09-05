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

export const ProfileWordPersonalSchema = z.object({
  id: z.string(),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  mine: z.boolean(),
});

export const ProfileWordsResponseSchema = z.object({
  source: ProfileSourceKindSchema,
  facet: ProfileFacetSchema,
  category: TeaCategorySchema.optional(),
  general: z.array(ProfileWordGeneralSchema),
  shared: z.array(ProfileWordSharedSchema),
  /** 引用許可の仕組みが未実装のため、実装されるまで常に空配列 (正しい振る舞い)。 */
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
  /** カメラの倍率段 (10 の冪)。0 = マクロ。 */
  z: number;
}

export interface ProfileWordsParams {
  facet: ProfileFacet;
  category?: TeaCategory;
  bbox: readonly [number, number, number, number];
  /** 認証済みなら userKey (D6b: personal は認証必須が既定)。 */
  userKey: string | null;
}
