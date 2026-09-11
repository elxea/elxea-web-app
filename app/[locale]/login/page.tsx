/**
 * ログイン画面 — Figma【R2: 確定版】`AWLnI0XF07e8rScuxPYPc7`
 * section 6702:8970 / PC 6702:8971 / SP 6706:14444 / 状態 6706:14468
 *
 * 画面としてやるのは「ログインへ促す」ところまで。パスワード入力は Shopify
 * ホスト側 (account.elxea.com) が受け持つため自前実装しない。
 *
 * 認証配線は既存のまま (改変しない):
 * 1. LineLoginButton が chat session_id を cookie に載せる (client)
 * 2. /api/line-callback が code をトークン交換して identity を紐付ける
 * 3. 戻り先で LinkSuccessBanner が結果を出す
 * 4. メールアドレスでログインは /api/auth/login → Shopify OAuth (PKCE)
 */
import { Suspense } from "react";
import { getTranslations, getLocale } from "next-intl/server";
import {
  AuthCard,
  AuthCardActions,
  AuthCardDescription,
  AuthCardDivider,
  AuthCardFootnote,
  AuthCardHeader,
  AuthCardKicker,
  AuthCardTitle,
  AuthSection,
} from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { LineLoginButton, LineLoginButtonFallback } from "./line-login-button";
import { LinkSuccessBanner } from "./link-success-banner";
import { AuthErrorBanner } from "./auth-error-banner";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return {
    title: t("title"),
  };
}

export default async function LoginPage() {
  const t = await getTranslations("login");
  const locale = await getLocale();

  return (
    <AuthSection>
      <AuthCard>
        {/* 状態バナー — Figma 6706:14468「カード上部に条件表示（該当クエリ時のみ）」 */}
        <Suspense fallback={null}>
          <AuthErrorBanner />
        </Suspense>
        <Suspense fallback={null}>
          <LinkSuccessBanner />
        </Suspense>

        {/* Header Block 6702:9010 */}
        <AuthCardHeader>
          <AuthCardKicker>Account</AuthCardKicker>
          <AuthCardTitle>{t("heading")}</AuthCardTitle>
          <AuthCardDescription>{t("description")}</AuthCardDescription>
        </AuthCardHeader>

        {/* Actions 6702:9014 */}
        <AuthCardActions>
          {/* ボタンは `?error=` を読んで「押しても直らない失敗」のときに自分を
            * 無効化する (line-login-button の解説)。`useSearchParams` を使うので
            * バナーと同じく Suspense 境界が要る。fallback は押せない同型のボタン —
            * null にすると境界が解けるまでボタンごと消えて画面が跳ねる。 */}
          <Suspense fallback={<LineLoginButtonFallback>{t("lineButton")}</LineLoginButtonFallback>}>
            <LineLoginButton>{t("lineButton")}</LineLoginButton>
          </Suspense>

          {/* LINE のメールアドレス取得についての説明 (M-0 の前提整備)。
            *
            * ## なぜカード下部の同意文と別に置くのか
            *
            * 下の `terms` は「利用規約とプライバシーポリシーに同意したとみなす」という
            * 包括の一文で、**何を取得するかは書いていない**。LINE ログインの email scope は
            * 「LINE に登録されたメールアドレスを受け取る」という具体的な取得で、LINE の
            * 審査もその用途の明示を求める。包括の同意文に埋めると、押す直前に読まれない。
            *
            * よって **押すボタンのすぐ下** に、取得するもの (LINE のメールアドレス) と
            * 使う用途 (注文確認・お問い合わせ対応・アカウント連携) だけを 1 文で置く。
            * 用途を増やすときはこの文も直すこと — ここが利用者に約束した範囲になる。 */}
          <p
            className="w-full text-center text-xs leading-4 text-muted-foreground"
            data-testid="line-email-consent"
          >
            {t("lineEmailConsent")}
          </p>

          <AuthCardDivider>{t("or")}</AuthCardDivider>

          {/* Shopify OAuth (PKCE)。Figma 6893:17352 = secondary */}
          <Button variant="secondary" className="w-full shadow-xs" asChild>
            {/* Route Handler なので next/link ではなく素の <a> で遷移させる */}
            <a href={`/api/auth/login?locale=${locale}`}>{t("shopifyButton")}</a>
          </Button>
        </AuthCardActions>

        {/* 同意文 6702:9024 — 利用規約 / プライバシーポリシーは下線付きリンク */}
        <AuthCardFootnote>
          {t.rich("terms", {
            terms: (chunks) => (
              <Link
                href="/legal/terms"
                className="underline underline-offset-2 transition-colors hover:text-foreground"
              >
                {chunks}
              </Link>
            ),
            privacy: (chunks) => (
              <Link
                href="/legal/privacy"
                className="underline underline-offset-2 transition-colors hover:text-foreground"
              >
                {chunks}
              </Link>
            ),
          })}
        </AuthCardFootnote>
      </AuthCard>
    </AuthSection>
  );
}
