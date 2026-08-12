import { ReadingWash } from "@/components/roji/reading-wash";

/**
 * 読みもの系ページのレイヤー。
 *
 * ## 何のためのグループか
 * roji の「眺め」= 季節のにじみを敷く面をここに限る。ルートグループ (括弧付き
 * ディレクトリ) は **URL に出ない** ので、`/journal/...` `/about` 等のアドレスは
 * 移動前と同じまま、レイアウトだけを共有できる。
 *
 * ## どこまでを読みものと呼ぶか
 * 入っているのは journal / elxea-journal / tea-menu / farmers / playlists /
 * tasting-note / about。共通するのは **読むために来て、読み終わるまで留まる面**
 * であること。買う・探す・手続きする面 (products / collections / cart / search /
 * account / login / contact / faq / legal / subscription / membership 等) は
 * 入れていない。背景が動くと、値段や在庫や入力欄のような
 * 「読み違えてはいけないもの」の後ろで動くことになるため。
 *
 * 面の敷き方と、`<body>` の背景を外さずに済んでいる理由は
 * `components/roji/reading-wash.tsx` の説明を参照。
 */
export default function ReadingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ReadingWash />
      {children}
    </>
  );
}
