import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Breadcrumb } from "@/components/seo/breadcrumb";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: t("privacy") };
}

export default async function PrivacyPage() {
  const t = await getTranslations("legal");
  const bt = await getTranslations("breadcrumb");

  return (
    <div className="section-narrow">
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: t("privacy") },
        ]}
      />
      <h1 className="mb-12">{t("privacy")}</h1>

      <div className="space-y-10 text-sm leading-relaxed text-muted-foreground">
        <Section title="1. 個人情報の取得">
          <p>
            当社は、以下の個人情報を適法かつ公正な手段により取得します。
          </p>
          <ul className="list-disc pl-5 mt-3 space-y-1">
            <li>氏名、メールアドレス、住所、電話番号</li>
            <li>注文履歴、お届け先情報</li>
            <li>クレジットカード情報（決済代行会社を通じて処理）</li>
            <li>サイト閲覧履歴（Cookie等による）</li>
            <li>お問い合わせ内容</li>
          </ul>
        </Section>

        <Section title="2. 利用目的">
          <ul className="list-disc pl-5 space-y-1">
            <li>商品の発送およびサービスの提供</li>
            <li>ご注文内容の確認、お問い合わせへの対応</li>
            <li>定期便の管理（発送スケジュール、決済処理）</li>
            <li>新商品・キャンペーン等のご案内（同意いただいた場合）</li>
            <li>サイトの改善およびサービス向上のための分析</li>
          </ul>
        </Section>

        <Section title="3. 第三者提供">
          <p>
            当社は、以下の場合を除き、お客様の個人情報を第三者に提供することはありません。
          </p>
          <ul className="list-disc pl-5 mt-3 space-y-1">
            <li>お客様の同意がある場合</li>
            <li>法令に基づく場合</li>
            <li>配送業者への配送に必要な情報の提供</li>
            <li>決済処理のための決済代行会社への提供</li>
          </ul>
        </Section>

        <Section title="4. Cookieの利用">
          <p>
            当サイトでは、お客様の利便性向上およびサイト分析のためにCookieを使用しています。
            Cookieは、お客様のブラウザ設定により無効にすることが可能です。
            ただし、Cookieを無効にした場合、一部のサービスがご利用いただけなくなる場合があります。
          </p>
          <p className="mt-3">当サイトで利用するCookieの種類：</p>
          <ul className="list-disc pl-5 mt-2 space-y-1">
            <li>必須Cookie：サイトの基本機能、カート、認証に必要</li>
            <li>分析Cookie：Google Analytics等によるサイト利用状況の分析</li>
          </ul>
        </Section>

        <Section title="5. 安全管理措置">
          <p>
            当社は、個人情報の漏洩、滅失又は毀損の防止のため、適切な安全管理措置を講じます。
            お客様の認証情報はAES-256-GCMにより暗号化して保存しています。
          </p>
        </Section>

        <Section title="6. 個人情報の開示・訂正・削除">
          <p>
            お客様ご本人から個人情報の開示、訂正、削除のご請求があった場合は、
            本人確認の上、速やかに対応いたします。下記のお問い合わせ先までご連絡ください。
          </p>
        </Section>

        <Section title="7. お問い合わせ先">
          <p>
            個人情報の取扱いに関するお問い合わせは、以下までご連絡ください。
          </p>
          <p className="mt-3">
            株式会社elxea<br />
            メール：support@elxea.com
          </p>
        </Section>

        <Section title="8. 改定">
          <p>
            当社は、必要に応じて本プライバシーポリシーを改定することがあります。
            改定した場合は、当サイトにて公表いたします。
          </p>
        </Section>

        <p className="text-xs text-muted-foreground">
          制定日：2026年3月1日
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-foreground mb-4">{title}</h2>
      {children}
    </section>
  );
}
