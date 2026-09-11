import { cn } from "@/lib/utils";

/**
 * PersonPlaceholder — 人物の写真枠に、写真が無いあいだ敷く面。
 *
 * 無地の `ImagePlaceholder` との違いと、その使い分け
 * --------------------------------------------------
 * 汎用の `image-placeholder.tsx` は **中身を持たない**。器の大きさが呼び出し側で
 * 10 倍以上ちがうので「どの大きさでも成立する図案を 1 つ置くのは無理」という
 * 理由で、Setaka 指示 (2026-08-25) により意図的に空にしてある。**その判断は
 * 生きている — ここで覆していない。** 汎用枠は今も無地のままである。
 *
 * 人物枠だけを分けるのは、汎用枠に無かった 2 つの条件がそろうから:
 *   1. 被写体が誰なのか分かっている (名前を持つ 1 人)。よって図案を「その人の
 *      頭文字」として名前から導ける。器ごとに図案を選び直す必要がない。
 *   2. 頭文字は固定の図版ではなく **文字** なので、器に対する比率で置けば
 *      32px のクレジットから 640x800 のヒーローまで同じ見え方で伸縮する。
 *      2026-08-25 に問題になった「小さい枠でロゴが器を埋める / 大きい枠で
 *      豆粒になる」が起きない。
 * つまり 2026-08-25 の判断の理由 (図案が器に追従できない) が、人物枠では
 * 成立しない。無地のままにする理由が無いので、人物枠だけ頭文字を出す。
 *
 * 語彙は新造ではない。記事冒頭のクレジット (`journal/author-byline.tsx` →
 * `ui/avatar.tsx` の `AvatarFallback`) が既に「写真が無ければ頭文字を
 * `bg-muted` / `text-muted-foreground` で出す」形を本番で使っている。ここは
 * その既存の語彙を、Avatar が担当しない大きい枠 (人物詳細のヒーロー・
 * 人物カード・記事末尾のプロフィール) へ広げるだけ。
 *
 * 実在の人物と誤認されない意匠であること
 * --------------------------------------
 * 顔写真は一切使わない (他人の実写の流用も、生成した人物画も使わない)。
 * 出すのは頭文字 1 文字だけで、アバターの慣用表現として「写真がまだ無い」と
 * 読める。掲載同意が未解決のあいだ、実在の人物の実写をここに置かない。
 *
 * 台帳との関係 (重要)
 * -------------------
 * これは **描画時の既定** であって Sanity のデータではない。`author.image` は
 * 未設定のままなので、写真運用の欠落検出 (経路5 / elxea-asset-hub
 * `scripts/lib/photo-gap-core.mjs` の `scanPersons`) は引き続きこの人を
 * 「顔写真が無い」として挙げ続ける。**公開面は整っているが台帳では未設定**が
 * 正しい状態で、この分離は壊さないこと。ここでプレースホルダーを Sanity に
 * 書き込むと台帳が「写真あり」と嘘をつき、本物の写真を用意する動機が消える。
 */

/** 名前の 1 文字目。結合文字を割らないよう `Array.from` で取る。 */
function monogramOf(name: string | null | undefined): string {
  const first = Array.from(String(name ?? "").trim())[0];
  if (!first) return "";
  // ラテン文字だけ大文字に寄せる。日本語はそのまま (toUpperCase は無害だが、
  // 意図を明示するため条件を書く)。
  return /[a-z]/.test(first) ? first.toUpperCase() : first;
}

export function PersonPlaceholder({
  name,
  className,
}: {
  /** 頭文字の元になる氏名。空なら文字を出さず無地の面になる。 */
  name?: string | null;
  className?: string;
}) {
  const initial = monogramOf(name);

  return (
    <div
      data-slot="person-placeholder"
      aria-hidden="true"
      className={cn(
        "flex h-full w-full items-center justify-center bg-muted text-muted-foreground",
        className
      )}
    >
      {initial ? (
        // 文字を SVG で置くのは、器の比率が枠ごとに違う (4:5 / 8:5 / 1:1) ため。
        // viewBox + preserveAspectRatio なら器の短辺に合わせて等比で収まるので、
        // 枠ごとに font-size を調整しなくても同じ見え方になる。
        // 上限 (max-*-20 = 80px) を置くのは、640x800 のヒーローで頭文字が
        // 主張しすぎないようにするため。静かな面のままにしておく。
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          focusable="false"
          role="presentation"
          className="h-1/2 max-h-20 w-1/2 max-w-20"
        >
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="56"
            fontWeight="300"
            fill="currentColor"
            style={{ fontFamily: "inherit" }}
          >
            {initial}
          </text>
        </svg>
      ) : null}
    </div>
  );
}
