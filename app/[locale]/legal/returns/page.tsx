import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Breadcrumb } from "@/components/seo/breadcrumb";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: t("returns") };
}

export default async function ReturnsPage() {
  const t = await getTranslations("legal");
  const bt = await getTranslations("breadcrumb");

  return (
    <div className="section-narrow">
      <Breadcrumb
        items={[
          { label: bt("home"), href: "/" },
          { label: t("returns") },
        ]}
      />
      <h1 className="mb-12">{t("returns")}</h1>

      <div className="space-y-10 text-sm leading-relaxed text-muted-foreground">
        <Section title="返品について">
          <p>
            当社の商品は食品のため、お客様のご都合による返品・交換はお受けしておりません。
            ご了承の上、ご注文ください。
          </p>
        </Section>

        <Section title="不良品・誤配送の場合">
          <p>
            以下の場合に限り、商品の交換または返金にて対応いたします。
          </p>
          <ul className="list-disc pl-5 mt-3 space-y-1">
            <li>商品に破損や汚損があった場合</li>
            <li>注文した商品と異なる商品が届いた場合</li>
            <li>賞味期限が過ぎている商品が届いた場合</li>
          </ul>
        </Section>

        <Section title="お手続きの流れ">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              <span className="text-foreground font-medium">ご連絡</span>
              <br />
              商品到着後7日以内に、support@elxea.com までメールにてご連絡ください。
              ご注文番号と不具合の内容をお知らせください。
            </li>
            <li>
              <span className="text-foreground font-medium">状態の確認</span>
              <br />
              必要に応じて、商品の写真をお送りいただく場合があります。
            </li>
            <li>
              <span className="text-foreground font-medium">交換・返金</span>
              <br />
              確認後、代替品の発送または返金手続きを行います。
              返金はご利用の決済方法に応じた形で処理いたします。
            </li>
          </ol>
        </Section>

        <Section title="返金のタイミング">
          <p>
            返金手続き完了後、クレジットカード会社の処理により、実際の返金までに
            5〜10営業日程度かかる場合があります。
          </p>
        </Section>

        <Section title="お問い合わせ先">
          <p>
            株式会社elxea<br />
            メール：support@elxea.com<br />
            営業時間：平日 10:00〜18:00（土日祝休み）
          </p>
        </Section>
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
