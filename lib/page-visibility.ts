import { locales } from "@/i18n/config";

/**
 * ページ単位の公開制御の**判定そのもの**。正本の値 (`config/page-visibility.json`)
 * は持たず、渡された宣言だけで答えを出す。
 *
 * ## なぜ middleware から切り出してあるのか
 *
 * 判定が `middleware.ts` の中にあると、「この宣言ならこう判定する」を確かめるのに
 * **middleware をモジュールごと読み直す**しかない。読み直すには宣言 JSON を
 * モジュールモックで差し替える必要があり、差し替えとモジュール読み込みの順序は
 * テストランナーの内部事情 (モック登録の解決が非同期) に依存する。実際 Step 1 の
 * 初版はこれが原因で、同じテストが 10 回に 2 回ほど「実物の宣言を読んでしまって」
 * 落ちた (2026-09-13 QA 実測: 8/10 は 20/20 PASS、2/10 は 18/20)。
 *
 * 判定を**引数で宣言を受け取る純粋関数**にすると、差し替えという概念が消える。
 * 呼び出し側 (`middleware.ts`) は起動時に一度だけ実物の宣言から索引を作る。
 *
 * ## 判定の中身
 *
 * - locale 接頭辞は外してから引く。`/ja/journal` と `/journal` は宣言の同じ 1 行が
 *   受け持つ (宣言に locale 接頭辞を書くことは `validateManifest` が禁じている)。
 * - 静的な宣言を先に見る。`/journal/category` は `/journal/[slug]` ではなく
 *   自分の行に当たる。
 * - どちらにも当たらなければ `undefined` = 「宣言に無い」。これをどう扱うか
 *   (404 を返すか Next に渡すか) は呼び出し側の判断で、ここでは決めない。
 */

/** 宣言 1 行分のうち、判定に要る最小限。 */
export interface PageVisibilityDeclaration {
  route: string;
  visible: boolean;
}

/** 宣言を引きやすい形に組み直したもの。`buildVisibilityIndex` が作る。 */
export interface PageVisibilityIndex {
  /** 静的ルート (`/journal` 等) の公開可否。 */
  readonly staticRoutes: ReadonlyMap<string, boolean>;
  /** 動的ルート (`/journal/[slug]` 等) の公開可否。セグメントに割ってある。 */
  readonly dynamicRoutes: readonly {
    readonly segments: readonly string[];
    readonly visible: boolean;
  }[];
}

/**
 * 公開を止めている locale ではなく、**実装がある全 locale** の接頭辞を外す。
 * `/en/journal` は転送される前提だが、転送より後にこの判定が走るとは限らない
 * 読み方をしたくないので、判定側は locale に依らず同じ答えを返す。
 */
const LOCALE_PREFIX = new RegExp(`^/(?:${locales.join("|")})(?=/|$)`);

/** 宣言の配列から索引を作る。起動時に 1 回だけ呼ぶ想定。 */
export function buildVisibilityIndex(
  routes: readonly PageVisibilityDeclaration[],
): PageVisibilityIndex {
  return {
    staticRoutes: new Map(
      routes
        .filter((entry) => !entry.route.includes("["))
        .map((entry) => [entry.route, entry.visible] as const),
    ),
    dynamicRoutes: routes
      .filter((entry) => entry.route.includes("["))
      .map((entry) => ({
        segments: entry.route.split("/").filter(Boolean),
        visible: entry.visible,
      })),
  };
}

/**
 * URL の path を宣言と同じ書き方に揃える。
 * locale 接頭辞を外し、末尾の `/` を落とし、空になったらトップ (`/`) にする。
 */
export function normalizeVisibilityPath(pathname: string): string {
  const stripped = pathname.replace(LOCALE_PREFIX, "");
  if (stripped === "") return "/";
  if (stripped.length > 1 && stripped.endsWith("/")) return stripped.slice(0, -1);
  return stripped;
}

/**
 * この path の公開可否を引く。`undefined` は「宣言に無い」= 未登録。
 */
export function lookupVisibility(
  index: PageVisibilityIndex,
  pathname: string,
): boolean | undefined {
  const normalized = normalizeVisibilityPath(pathname);

  const exact = index.staticRoutes.get(normalized);
  if (exact !== undefined) return exact;

  const segments = normalized.split("/").filter(Boolean);
  for (const candidate of index.dynamicRoutes) {
    if (candidate.segments.length !== segments.length) continue;
    const matched = candidate.segments.every(
      (segment, i) =>
        (segment.startsWith("[") && segment.endsWith("]")) || segment === segments[i],
    );
    if (matched) return candidate.visible;
  }

  return undefined;
}
