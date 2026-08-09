import { permanentRedirect } from "next/navigation";
import { getLocale } from "next-intl/server";

import { getPathname } from "@/i18n/navigation";

/**
 * メンバーシップ /ja/membership → 定期便LP /ja/subscription へ恒久転送。
 *
 * ## なぜページを持たないのか (R2 の決定)
 *
 * メンバーシップは **R2 でページごと廃止**され、プラン選択が定期便LP の中に
 * 畳まれた。Figma 側の根拠 (いずれも R2 確定版 定期便LP セクション `7609:2` 内):
 *
 * - `7973:42297` 節見出し「10. プラン選択 + 購入導線 (最下部のみ / メンバーシップ統合)」
 * - `7973:42298` 「メンバーシップページ廃止 (決定 2026-08-08) に伴い、プラン選択を
 *   LP 内に畳む。頻度 (毎月 / 隔月) と内容 (3種おまかせ / 好み指定) をこの一箇所で
 *   選ばせ、価格 + 申し込みボタンを置く」
 * - `7973:42290` 「メンバーシップページの『12ヶ月のリズム』をこちらへ移設し一本化」
 * - `7973:42296` 「(FAQ は) メンバーシップ側 FAQ と重複しないようこちらを正本にする」
 * - 実体として R2 確定版 LP に節が存在する: PC `8071:514` (1440x823) /
 *   SP `8073:186` (375x761)「プラン選択 + 購入導線 (最下部のみ / メンバーシップ統合)」
 *
 * リポジトリ側でも同じ決定が既に記録されている。`playwright.config.ts` は
 * `membership.spec.ts` を CI 除外し続ける理由を「会員ランク制度そのものが
 * 『無し』に決定済 (2026/08/08)。仕様が消えたので復帰させず廃止候補として残置する」
 * と書いている。旧実装が並べていた 3 ティア (フリー / スタンダード / プレミアム) の
 * 比較表は、その消えた仕様そのものだった。
 *
 * ## なぜ削除ではなく転送なのか
 *
 * ルートを消すと既存の受信リンク (会員限定ゲートの導線・外部からのブックマーク) が
 * 404 になる。R2 の行き先が定期便LP に一本化されている以上、正しい振る舞いは
 * 「同じ意図の新しい行き先へ恒久転送」。`permanentRedirect` (308) を使うので
 * 検索側にも統合が伝わる。ロケールは `getPathname` で解決するため
 * `/en/membership` は `/en/subscription` に着く。
 *
 * @see docs/fidelity/c13-1-fidelity.md 忠実度対比表 (転送先 = LP のプラン選択節)
 */
export default async function MembershipPage() {
  const locale = await getLocale();
  permanentRedirect(getPathname({ href: "/subscription", locale }));
}
