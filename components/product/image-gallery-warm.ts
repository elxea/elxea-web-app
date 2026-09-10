/**
 * 拡大表示 (ズーム) 用の写真を**どれだけ先に取っておくか**の規則。
 *
 * ## 直している症状 (網羅表 2026-08-27 / G3・B2・B3)
 *
 * PR #169 で、サムネイルを押したときのメイン写真 (800px) は先読みされるように
 * なった。**しかしズームは第 3 のサイズ (1200px) を使う**。`next/image` は
 * `width` / `sizes` から `_next/image?...&w=` を組み立てるので、800px 版が
 * 温まっていてもズームの URL は別物で、まだ 1 度も取られていない。
 *
 * しかも Radix の `DialogContent` は閉じるとアンマウントされるので、**開くたび
 * に毎回「初回」**になる。placeholder も blur も無いため、その間は無地のまま
 * 待つことになる (G3)。ズーム内の前へ / 次へ (B2) も同じ 1200px を都度取る。
 *
 * ## 何枚まで温めるか — 全部は取らない
 *
 * 1200px を最初から全部取ると、商品 1 ページで 7 枚ぶんの大きい写真を、押される
 * かどうかも分からないうちに取ることになる。だから**いま出ている 1 枚**だけを
 * 温め、ズームが開いているあいだだけ**その左右**を足す (前へ / 次へで次に要る
 * のは必ず隣だから)。
 *
 * 温めた枚数は減らさない (`mergeWarm`)。取りかけの写真をアンマウントで捨てると、
 * サムネイルを行ったり来たりしたときに毎回取り直しになる。
 */

/** いま温めるべき写真の番号。`zoomOpen` のときだけ左右を足す。 */
export function zoomWarmTargets(
  selected: number,
  count: number,
  zoomOpen: boolean,
): number[] {
  if (count <= 0) return [];
  if (selected < 0 || selected >= count) return [];

  const targets = [selected];
  if (zoomOpen && count > 1) {
    targets.push((selected - 1 + count) % count);
    targets.push((selected + 1) % count);
  }
  return [...new Set(targets)];
}

/**
 * 既に温めた集合へ追加する。**追加が無いときは同じ配列をそのまま返す** —
 * 毎回新しい配列を返すと、これを state に入れた効果が自分自身を呼び直して
 * 描き直しが止まらなくなる。
 */
export function mergeWarm(
  current: readonly number[],
  targets: readonly number[],
): readonly number[] {
  const added = targets.filter((i) => !current.includes(i));
  if (added.length === 0) return current;
  return [...current, ...added].sort((a, b) => a - b);
}
