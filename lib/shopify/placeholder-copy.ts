/**
 * 商品説明に残った「入稿待ちの印」を、公開画面に出さないための判定。
 *
 * ## 何が起きていたか (#11)
 *
 * 販売中の商品 5 点の説明文が `【準備中】` の 1 語だけだった (実測 2026-08-25:
 * tea-ats-b-05 / tea-ats-g-04 / tea-ats-o-03 / tea-ats-o-04 / tea-ats-o-05)。
 * 商品詳細はタイトルの直下にこれを出すので、**買えるのに「準備中」と書いてある**
 * 画面になっていた。実際にはどれも販売中で価格も付いており (同シリーズの他 4 点は
 * 本文が入っている)、過去に同じ商品の支払い済み注文もある。つまり準備中なのは
 * 「商品」ではなく「説明文」で、表示のほうが事実と食い違っている。
 *
 * ## どう直すか
 *
 * 説明文が **印だけ** のときは、説明が無いものとして扱う (空文字を返す)。
 * 画面側は元々「説明が無ければその段落を描かない」作りなので、これだけで
 * 誤った断り書きが消える。SEO の description も同じ経路を通るので、検索結果に
 * 「【準備中】」が出ることも同時に無くなる。
 *
 * 本文を勝手に書き足すことはしない (文章は入稿の仕事)。印が入ったままの商品が
 * あることは運用側に報告する。
 *
 * ## 何を印とみなすか
 *
 * 「本文全体が印だけ」のときに限る。本文中に「準備中」の語が含まれるだけの
 * 正当な文章 (例:「次回分は準備中です」) は消さない。
 */

/** 本文がこれ **だけ** なら入稿待ちとみなす語。前後の括弧・記号は下で剥がす。 */
const PLACEHOLDER_WORDS = new Set(["準備中", "coming soon", "tbd", "wip"]);

/** 判定用に本文を均す: タグを外し、囲みの括弧と空白を落として小文字化。 */
function normalize(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[【】\[\]（）()<>《》「」『』]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 本文全体が入稿待ちの印だけか。 */
export function isPlaceholderCopy(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalize(text);
  if (normalized === "") return false;
  return PLACEHOLDER_WORDS.has(normalized);
}

/** 入稿待ちの印だけなら空文字にする (それ以外はそのまま)。 */
export function stripPlaceholderCopy<T extends string | null | undefined>(
  text: T,
): T | "" {
  return isPlaceholderCopy(text) ? "" : text;
}
