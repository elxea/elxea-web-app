/**
 * ジャーナル一覧の「いま効いている絞り込み」を決める。
 *
 * ## なぜ切り出してあるか
 *
 * 一覧の取得は、カテゴリ件数の返事を待たずに **先読み** で投げている
 * (`?category=` の指定をそのまま使って 4 本を並行に走らせる)。往復を 1 段減らす
 * ためだが、その代わり「指定が実在しないカテゴリだった」ときに先読みの結果を捨てて
 * 引き直す判断が要る。その判断の中心がこの関数で、ここが壊れると
 *
 *   - 綴り違いの `?category=` が「絞り込みなし」に落ちず 0 件表示になる、または
 *   - 実在するカテゴリなのに毎回引き直して往復が 1 段増える
 *
 * のどちらかが静かに起きる。画面には出にくいのでテストで押さえる。
 */

/** 指定が実在しなければ "all" に倒す。 */
export function resolveActiveCategory(
  requested: string | undefined,
  availableSlugs: readonly string[],
): string {
  if (!requested) return "all";
  return availableSlugs.includes(requested) ? requested : "all";
}

/**
 * 先読みした一覧をそのまま使えるか。
 *
 * 先読みは `requested ?? "all"` で投げてあるので、確定した `activeCategory` が
 * それと同じときだけ使える。異なる = 指定が実在しなかった場合なので引き直す。
 */
export function canUseSpeculativeBundle(
  requested: string | undefined,
  activeCategory: string,
): boolean {
  return activeCategory === (requested ?? "all");
}
