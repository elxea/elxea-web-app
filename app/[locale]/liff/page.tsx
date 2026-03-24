import { getLocale } from "next-intl/server";
import { LiffProvider } from "@/components/liff/liff-provider";
import { LiffMyPage } from "@/components/liff/liff-mypage";

/**
 * LIFF マイページ
 *
 * LINE の LIFF ブラウザ内で開かれるマイページ。
 * ユーザーには「マイページ」として表示される。
 *
 * フロー:
 *   1. LIFF SDK 初期化（クライアントサイド）
 *   2. LINE ログイン確認
 *   3. LINE user ID 取得
 *   4. Shopify セッション確認 → /api/user/line-link で Firestore に lineUserId 保存
 *   5. お茶プロフィール画面表示
 *
 * 環境変数:
 *   NEXT_PUBLIC_LIFF_ID — LINE LIFF ID（未設定時はモック動作）
 */
export default async function LiffPage() {
  const locale = await getLocale();

  return (
    <LiffProvider>
      <LiffMyPage locale={locale} />
    </LiffProvider>
  );
}
