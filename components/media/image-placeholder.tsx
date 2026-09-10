/**
 * ImagePlaceholder — 画像が無いときに敷く面。
 *
 * ライトグレー 1 色だけを敷く。中に何も置かない。
 *
 * 以前はここに elxea ロゴ (`/logo.png` を `next/image` の width=80) を重ねて
 * いたが、`width` は器の大きさを見ないので、小さい枠ほどロゴが器を埋めた。
 * 実例: マイページのお気に入りのサムネは SP で 96x72 (`account-parts.tsx`)
 * なので、80px のロゴが横幅の 83% を占め、余白がほぼゼロで貼り付いて見えた。
 * 逆に記事カード (600px 級) では同じロゴが豆粒になり、面ごとに見え方が違った。
 *
 * 器の大きさは呼び出し側 (サムネ 96px 〜 ヒーロー 1000px 級) で 10 倍以上ちがう。
 * 「どの大きさでも成立する図案」を 1 つ置くのは無理で、器ごとにロゴ寸法を
 * 調整すれば今度は面ごとにバラつく。中身を持たない面にすれば、その調整自体が
 * 不要になり全面で同じ見え方になる (Setaka 指示 2026-08-25)。
 *
 * 色は `bg-muted` (= `--color-muted`)。DS のライトグレーで、生の HEX は使わない。
 */
export function ImagePlaceholder({ className }: { className?: string }) {
  return (
    <div
      data-slot="image-placeholder"
      aria-hidden="true"
      className={`w-full h-full bg-muted ${className ?? ""}`}
    />
  );
}
