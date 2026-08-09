import { getLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";

/**
 * 法人お問い合わせ — R2 で本ページは廃止され、`/contact` の 1 ページに統合された。
 *
 * Figma【R2: 確定版】お問い合わせ (`8109:46652`) はフレーム名のとおり
 * 「Common 静的 1 ページ」で、法人・取材は `お問い合わせの種類` の選択肢
 * (`8109:46695` 注記「お客様のお問い合わせ / お取引・取材等のご相談」) に吸収されている。
 * Common ページ (`7567:12`) の全数走査でも法人専用の R2 フレームは存在しない。
 *
 * ページを削除せずリダイレクトにしているのは、既存の被リンク・ブックマーク・
 * 検索結果を切らないため。送信先メールボックスの振り分けは
 * `app/api/contact/route.ts` の `category` に移した (R1 の挙動は保持)。
 */
export default async function BusinessContactRedirectPage() {
  redirect({ href: "/contact", locale: await getLocale() });
}
