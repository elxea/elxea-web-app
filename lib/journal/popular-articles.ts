import { unstable_cache } from "next/cache";

import { getAdminFirestore } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

/**
 * 「人気の記事」の実データ集計 (A10)。
 *
 * これまでサイドバーの「人気の記事」は featured フラグを前に寄せただけ、
 * カテゴリ / タグページに至っては単に先頭 5 件で、名前と中身が一致していなかった。
 * 行動ログ (`users/{userKey}/behaviorLog`) には `view_content` が既に貯まって
 * いるので、それを集計して実際の閲覧数順に並べる。
 *
 * コストの抑え方 (ここが設計の要点):
 * - `collectionGroup` を 1 回だけ投げ、直近 `POPULAR_WINDOW_DAYS` 日 ×
 *   最大 `MAX_EVENTS` 件で必ず打ち切る。全期間・全件走査はしない。
 * - `unstable_cache` で `POPULAR_TTL_SECONDS` 秒キャッシュする。ページは
 *   パーソナライズのため動的レンダリングだが、この集計はリクエストごとに
 *   走らせない (全ユーザー共通の集計なので個別化する必要がない)。
 * - 失敗・データ不足は例外にせず空配列を返す。呼び出し側は現行の
 *   「特集が先・残りは新しい順」フォールバックをそのまま使う。
 *
 * 必要な Firestore インデックス (firestore.indexes.json に追加済み):
 *   collectionGroup=behaviorLog / queryScope=COLLECTION_GROUP /
 *   action ASC + createdAt DESC
 */

/** 集計対象の期間 (日)。長すぎると「今の人気」でなくなる。 */
export const POPULAR_WINDOW_DAYS = 30;

/** 1 回の集計で読む行動ログの上限 (件)。読み取りコストの上限そのもの。 */
export const MAX_EVENTS = 2000;

/** 集計結果のキャッシュ寿命 (秒)。 */
export const POPULAR_TTL_SECONDS = 3600;

/** これ未満のイベント数しか無いスラッグは「人気」と呼べないので落とす。 */
export const MIN_VIEWS = 2;

export type PopularArticle = { slug: string; views: number };

/** `unstable_cache` / revalidateTag から参照するタグ。 */
export const POPULAR_ARTICLES_TAG = "journal-popular-articles";

async function fetchPopularArticlesUncached(limit: number): Promise<PopularArticle[]> {
  const db = getAdminFirestore();
  const since = new Date(Date.now() - POPULAR_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const snapshot = await db
    .collectionGroup(COLLECTIONS.behaviorLog)
    .where("action", "==", "view_content")
    .where("createdAt", ">=", since)
    .orderBy("createdAt", "desc")
    .limit(MAX_EVENTS)
    .get();

  const tally = new Map<string, number>();
  for (const doc of snapshot.docs) {
    const metadata = doc.get("metadata") as { contentId?: unknown } | undefined;
    const contentId = metadata?.contentId;
    // `view_content` は記事の閲覧 (page_view) と読了 (read:<category>) の
    // 両方で使われる。どちらも「読まれた」印なので合算してよい。
    if (typeof contentId !== "string" || contentId.length === 0) continue;
    tally.set(contentId, (tally.get(contentId) ?? 0) + 1);
  }

  return [...tally.entries()]
    .filter(([, views]) => views >= MIN_VIEWS)
    .sort((a, b) => (b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]))
    .slice(0, limit)
    .map(([slug, views]) => ({ slug, views }));
}

const cachedPopularArticles = unstable_cache(
  fetchPopularArticlesUncached,
  ["journal-popular-articles"],
  { revalidate: POPULAR_TTL_SECONDS, tags: [POPULAR_ARTICLES_TAG] }
);

/**
 * 直近の閲覧数が多い記事スラッグを多い順に返す。
 *
 * 実データが無い / Firestore に届かない場合は空配列。呼び出し側は必ず
 * フォールバックを用意すること (この関数は投げない)。
 */
export async function getPopularArticles(limit = 5): Promise<PopularArticle[]> {
  if (limit <= 0) return [];
  try {
    return await cachedPopularArticles(limit);
  } catch {
    // 環境変数未設定 (プレビュー / ローカル)・インデックス未作成・権限不足は
    // すべてここに落ちる。人気順は「あれば嬉しい」情報なので落として続行する。
    return [];
  }
}

/**
 * 記事一覧を人気順に並べ替える。人気データに無い記事は元の並び順のまま後ろへ。
 *
 * 集計結果はスラッグしか持たないので、並べ替えの対象は呼び出し側が既に
 * 取得済みの記事に限られる (人気なのに窓の外にある記事を引き当て直すのは
 * この関数の責務ではない)。
 */
export function orderByPopularity<T extends { slug?: { current?: string } }>(
  articles: T[],
  popular: PopularArticle[]
): T[] {
  if (popular.length === 0) return articles;

  const rank = new Map(popular.map((p, index) => [p.slug, index]));
  return [...articles]
    .map((article, index) => ({ article, index }))
    .sort((a, b) => {
      const ra = rank.get(a.article.slug?.current ?? "") ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.article.slug?.current ?? "") ?? Number.MAX_SAFE_INTEGER;
      // 同順位 (= どちらも人気データに無い) は元の並びを保つ (安定ソート)。
      return ra === rb ? a.index - b.index : ra - rb;
    })
    .map((entry) => entry.article);
}
