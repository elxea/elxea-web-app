/**
 * Sanity の `seo` object を Next の `Metadata` に渡すための 1 枚の通り道。
 *
 * ## なぜヘルパーを置くのか
 *
 * `sanity/schemas/seo.ts` のフィールド名は `metaTitle` / `metaDescription` /
 * `ogImage` である。ところが 2026-09-12 時点で、詳細ページ 3 本
 * (tea-menu / journal / elxea-journal) は `seo?.title` / `seo?.description` を
 * 読んでいた。**スキーマに存在しない名前**なので値は常に undefined になり、
 * 編集者が Sanity で SEO を設定しても `<title>` にも
 * `<meta name="description">` にも一切出ない。
 *
 * この壊れ方はどこも赤くならない:
 *
 *   - 各ページが `seo?: { title?: string; description?: string }` という
 *     **実体と違うローカル型**を自前で宣言していたので tsc は通る
 *   - 値が無いときは元のタイトル (displayName / title) に落ちるので、
 *     画面はもっともらしく表示される
 *   - lint もテストも、フィールド名の綴りまでは見ない
 *
 * つまり「設定したのに効かない」が黙って成立する。再発を防ぐには、読む名前を
 * 各ページに散らさず 1 か所に寄せ、その 1 か所とスキーマの対応を機械で突合
 * するしかない (`__tests__/sanity-seo-metadata.test.ts` がそれを行う)。
 *
 * ## 使い方
 *
 * ```ts
 * const title = seoTitle(tea.seo, tea.displayName);
 * const description = seoDescription(tea.seo, tea.description?.slice(0, 160));
 * ```
 *
 * フォールバックの挙動は修理前と同じ (`seo` が空なら元の値を使う) で、
 * 変わるのは「設定された SEO が実際に効くようになる」ことだけ。
 */

/**
 * Sanity の `seo` object の形。`sanity/schemas/seo.ts` が正本で、ここは
 * その写し。名前がずれたら `__tests__/sanity-seo-metadata.test.ts` が落ちる。
 */
export type SanitySeo = {
  metaTitle?: string | null;
  metaDescription?: string | null;
  ogImage?: { asset?: object } | null;
};

/** 空文字・空白だけの入力は「未設定」として扱う (Sanity では空文字が残りうる)。 */
function present(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** メタタイトル。未設定ならページ既定のタイトルに落とす。 */
export function seoTitle(seo: SanitySeo | null | undefined, fallback: string): string {
  return present(seo?.metaTitle) ?? fallback;
}

/** メタディスクリプション。未設定ならページ既定の説明に落とす (それも無ければ undefined)。 */
export function seoDescription(
  seo: SanitySeo | null | undefined,
  fallback?: string | null
): string | undefined {
  return present(seo?.metaDescription) ?? present(fallback);
}
