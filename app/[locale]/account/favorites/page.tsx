import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

/**
 * `/ja/account/favorites` — **マイページ本体への恒久リダイレクト**。
 *
 * ## なぜページを畳んだのか (Setaka 実機指摘 2026-08-25)
 *
 * ここは「お気に入りを分類別に見る / その場で解除する」ための独立したページだった。
 * マイページ本体には抜粋 6 枚と「お気に入りをすべて見る」というリンクだけが載り、
 * 自分が保存したものを見るのに **1 回よけいに遷移が要った**。しかも抜粋に入らな
 * かった種類はマイページから存在ごと見えず、「保存したのに無くなった」と読める。
 *
 * ワンクッションを廃し、中身はマイページ本体 (`/account`) の「お気に入り」節へ
 * 移した。機能は 1 つも落としていない — 分類別表示・種類ごとの件数・その場の解除・
 * 0 件のときの「探しに行く」導線は、すべて `components/account/favorites-board.tsx`
 * ごと移設してある。
 *
 * このルート自体は残す。ブックマーク・過去の案内・検索結果からの流入を 404 に
 * しないため。行き先が 1 つになった以上、`redirect` 1 行で足りる。
 */
export default async function FavoritesPage() {
  const locale = await getLocale();
  redirect({ href: "/account", locale });
}
