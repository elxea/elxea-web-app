import type { QueryParams } from "next-sanity";

import type { CacheTag } from "@/lib/cache/tags";

import { getClient } from "./client";

/**
 * @sot sanity-read-gateway
 *
 * Sanity から読む唯一の入口。**キャッシュの扱いを型で必須**にする。
 *
 * ## なぜゲートウェイなのか (憲章 R2「外部との境界は 1 枚の通り道を必ず通る」)
 *
 * 直前まで、Sanity を読む箇所は 60 か所あり、そのうち **キャッシュの名札を
 * 付けていた箇所は 0 か所**だった。一方で webhook 側は
 * `revalidateTag(body._type)` を実行していた。剥がす側だけがあって貼る側が
 * 無いので、Sanity で記事を更新しても本番の表示は一切変わらない — しかも
 * webhook は 200 を返すので、どこにも失敗として現れない。
 *
 * 「名札を付けよう」という規律では同じことが再発する。実際この repo では
 * `lib/env.ts` (設定の生読みをやめる装置) が同じ失敗をしていて、正しく作られた
 * のに移行は 3 か所で止まり、残りの生読みに本番障害が 2 件落ちている。
 * だから装置ではなく **境界** にする:
 *
 *   - 読む側は `sanityFetch` しか呼べない (`eslint.config.mjs` の
 *     `no-restricted-imports` が `@/sanity/lib/client` を `app/**` から遮断する)
 *   - `sanityFetch` は `cache` を **省略できない** (下の union 型)
 *   - 使える名札は `lib/cache/tags.ts` の語彙だけ (`CacheTag`)
 *   - 名札と無効化の対応は突合テストが機械で検査する
 *     (`__tests__/cache-tags-registry.test.ts`)
 *
 * 「うっかり名札を忘れる」は型検査で落ち、「迂回して直に読む」は lint で落ち、
 * 「名札はあるが誰も剥がさない」はテストで落ちる。3 つの壊れ方それぞれに
 * 落ちる場所を用意してある。
 *
 * ## なぜ `use cache` ではなく旧モデル (fetch options) なのか
 *
 * Cache Components (`use cache` / `cacheTag`) は 2026-08-27 のスパイクで実測
 * 済みで、移行自体は成立するが、公式の段階移行 codemod が Next **16.3** 向け
 * であるのに対し本番は 16.2.1 で、安全網なしに 6-10 人日を進めることになる。
 * 反映されない問題の修理は Cache Components とは独立に成立するので、ここでは
 * 旧モデル (`fetch` の `next.tags`) で先に直す。
 * 実測記録: `deliverables/cache-components-spike-20260827.md` の推奨案 B。
 *
 * ## なぜ `cache: "force-cache"` を明示するのか
 *
 * Next 15 以降、`fetch` は **既定でキャッシュされない**。`next: { tags }` を
 * 渡しただけではキャッシュに入らず、名札も付かない (名札は「キャッシュされた
 * 項目に貼るラベル」なので、キャッシュされなければ存在しない)。したがって
 * `cache: "force-cache"` と `next.tags` は必ず対で渡す。片方だけでは
 * 修理前と同じ「空振り」に戻る。
 *
 * ## なぜ `useCdn: false` を強制するのか
 *
 * Sanity の CDN (`apicdn.sanity.io`) は Next のデータキャッシュの **外側に
 * ある 2 つ目のキャッシュ**で、`revalidateTag` からも `noStore` からも触れない。
 * 名札で剥がしたのに CDN が古い本文を返す、という「直したのに直らない」を
 * 生む。キャッシュはこのゲートウェイの内側 (Next のデータキャッシュ) 1 段に
 * 集約し、上流は常に実データを返させる。`force-cache` によって上流への実
 * リクエスト自体が激減するので、CDN を外す代償は無効化の確実性に見合う。
 */

/**
 * キャッシュの扱い。**省略できない**。
 *
 * - `{ tag }` — 名札付きで無期限にキャッシュする。`lib/cache/tags.ts` の
 *   `SANITY_TYPE_TO_TAGS` にその名札を剥がす行があることを突合テストが保証する。
 * - `{ noStore: true }` — キャッシュしない。**名札で無効化できない読み取り**
 *   専用。具体的には (a) クエリ自体が時刻に依存するもの (`now()` を含む
 *   `EVENTS_QUERY` は、記事の更新ではなく時間の経過で結果が変わるので、
 *   どんな名札を貼っても正しく剥がせない)、(b) cron のように毎回実データを
 *   見る必要があるもの。
 *
 * `tag` と `noStore` は排他。`{ tag: "...", noStore: true }` は型で弾く
 * (`never` フィールドを互いに立ててある)。
 */
export type SanityCacheSpec =
  | { readonly tag: CacheTag; readonly noStore?: never }
  | { readonly noStore: true; readonly tag?: never };

export interface SanityFetchArgs {
  readonly query: string;
  readonly params?: QueryParams;
  /** 省略するとコンパイルエラーになる。これがこのゲートウェイの存在理由。 */
  readonly cache: SanityCacheSpec;
  /**
   * Sanity の下書きを見る経路 (Presentation / draft mode)。
   * 下書きは **常にキャッシュしない** — `cache` に何を渡していても無視して
   * `no-store` で読む。下書きが本番のキャッシュに焼き付くのは事故なので、
   * 呼び出し側の指定より安全側を優先する。
   */
  readonly preview?: boolean;
}

/**
 * Sanity への読み取り。
 *
 * 戻り値の型引数は既定 `any` — 既存 60 か所の呼び出しは `const x: T = await ...`
 * のように **受け側で** 型を付けているか、`any` 前提で書かれている
 * (`settings?.navigation` 等)。ここで `unknown` を既定にすると、キャッシュの
 * 修理と型付けの改修が同じ変更に混ざる。型付けは別の作業として切り出す。
 */
export async function sanityFetch<T = any>({
  query,
  params,
  cache,
  preview = false,
}: SanityFetchArgs): Promise<T> {
  const client = getClient(preview);
  const queryParams = params ?? {};

  // 下書き経路は呼び出し側の指定より優先してキャッシュしない。
  if (preview) {
    return client.fetch<T>(query, queryParams, { useCdn: false, cache: "no-store" });
  }

  if (cache.noStore) {
    return client.fetch<T>(query, queryParams, { useCdn: false, cache: "no-store" });
  }

  return client.fetch<T>(query, queryParams, {
    useCdn: false,
    // `cache` と `next.tags` は対で渡す。片方だけでは名札が存在しない。
    cache: "force-cache",
    next: { tags: [cache.tag] },
  });
}
