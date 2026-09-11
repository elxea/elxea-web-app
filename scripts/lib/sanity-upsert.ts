/**
 * Notion 由来のフィールドだけを書き込む upsert。
 *
 * ## なぜ必要か (2026-08-22 の本番事故)
 *
 * 記事同期はこれまで `sanity.createOrReplace(doc)` で書いていた。
 * `createOrReplace` は **ドキュメント全体を差し替える** ため、`doc` に載せて
 * いないフィールドは毎回消える。
 *
 * Sanity の記事には Notion 台帳に存在しないフィールドがある:
 *   - `audioUrl` / `audioVideoUrl` / `cta` / `orderNumber` / `requiredTier`
 *     / `contentPersona` / `depthLevel` / `targetLayer` — Studio で入力する
 *   - `category` / `tags` / `author` / `relatedProducts` — Notion 側は空で、
 *     実際の値は `scripts/tag-articles.ts` と Studio が入れている
 *   - `seo.metaTitle` / `seo.ogImage` — 同期は `seo.metaDescription` しか
 *     書かないため、`seo` を丸ごと置き換えると道連れになる
 *
 * 定時実行 (毎時) を再開した 2026-08-22 の 1 回目で、22 記事すべての
 * `category` / `tags` と 19 件の `author`、15 件の `relatedProducts`、
 * 1 件の `audioUrl` が消えた。
 *
 * ## どう直したか
 *
 * 「無ければ作る」と「Notion 由来のフィールドだけ上書きする」を分ける:
 *
 *   1. `createIfNotExists({ _id, _type })` — 骨組みだけ作る
 *   2. `patch(_id).set(...)` — `doc` に載っているフィールドだけ上書きする
 *
 * `doc` に載っていないフィールドには一切触れないので、Studio 専用フィールドが
 * 残る。Notion が値を返さなかったフィールド (今の category/tags/author が
 * まさにこれ) も、呼び出し側が `doc` から省いている限り消えない。
 *
 * ## ネストしたオブジェクトの扱い
 *
 * `seo` のような「素のオブジェクト」は丸ごと `set` すると同期が書かない
 * サブフィールド (`metaTitle` / `ogImage`) を消してしまう。そこで素の
 * オブジェクトだけは `seo.metaDescription` のようなドットパスに展開し、
 * 親が無い場合に備えて `setIfMissing({ seo: {} })` を先に置く。
 *
 * 逆に `_type` を持つ値 (slug / image / reference) と配列は、Notion 側が
 * 値の全体を持っているので丸ごと置き換えてよい。
 */

export type SanityDocLike = Record<string, unknown> & {
  _id: string;
  _type: string;
};

export type UpsertPlan = {
  /** 骨組みだけの create (既存があれば何もしない) */
  createIfNotExists: { _id: string; _type: string };
  /** ドットパス set の前に親オブジェクトを用意する */
  setIfMissing: Record<string, unknown>;
  /** Notion 由来のフィールドだけ */
  set: Record<string, unknown>;
};

/** patch 対象として最小限必要な client の形 (テスト時に差し替えられるように) */
export interface UpsertCapableClient {
  createIfNotExists(doc: { _id: string; _type: string }): Promise<unknown>;
  patch(id: string): {
    setIfMissing(fields: Record<string, unknown>): ReturnType<
      UpsertCapableClient["patch"]
    >;
    set(fields: Record<string, unknown>): ReturnType<
      UpsertCapableClient["patch"]
    >;
    commit(): Promise<unknown>;
  };
}

/**
 * ドットパスに展開してよい「素のオブジェクト」か判定する。
 *
 * `_type` や `_ref` を持つものは Sanity の値オブジェクト (slug / image /
 * reference) なので展開せず丸ごと置き換える。
 */
function isMergeableObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return !("_type" in value) && !("_ref" in value) && !("_key" in value);
}

/**
 * doc から「何を createIfNotExists し、何を set するか」を組み立てる。
 *
 * IO を含まない純関数なので、そのままテストできる。
 */
export function planNotionUpsert(doc: SanityDocLike): UpsertPlan {
  const { _id, _type, ...rest } = doc;

  if (!_id) throw new Error("planNotionUpsert: _id is required");
  if (!_type) throw new Error("planNotionUpsert: _type is required");

  const set: Record<string, unknown> = {};
  const setIfMissing: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rest)) {
    // undefined は「Notion が値を持っていない」= 触らない、を意味する。
    if (value === undefined) continue;

    if (isMergeableObject(value)) {
      // 空オブジェクトは触らない (親だけ作っても意味がない)。
      const entries = Object.entries(value).filter(
        ([, sub]) => sub !== undefined
      );
      if (entries.length === 0) continue;

      setIfMissing[key] = {};
      for (const [sub, subValue] of entries) {
        set[`${key}.${sub}`] = subValue;
      }
      continue;
    }

    set[key] = value;
  }

  return { createIfNotExists: { _id, _type }, setIfMissing, set };
}

/**
 * Notion 由来のフィールドだけを書き込む。
 *
 * `createOrReplace` の代わりにこれを使うこと。Studio 専用フィールドを
 * 消さないことがこの関数の存在理由なので、`createOrReplace` に戻さないこと。
 */
export async function upsertFromNotion(
  client: UpsertCapableClient,
  doc: SanityDocLike
): Promise<void> {
  const plan = planNotionUpsert(doc);

  await client.createIfNotExists(plan.createIfNotExists);

  const hasSetIfMissing = Object.keys(plan.setIfMissing).length > 0;
  const hasSet = Object.keys(plan.set).length > 0;
  if (!hasSetIfMissing && !hasSet) return;

  let patch = client.patch(plan.createIfNotExists._id);
  if (hasSetIfMissing) patch = patch.setIfMissing(plan.setIfMissing);
  if (hasSet) patch = patch.set(plan.set);
  await patch.commit();
}
