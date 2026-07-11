import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Breadcrumb } from "@/components/seo/breadcrumb";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: t("terms") };
}

export default async function TermsPage() {
  const t = await getTranslations("legal");
  const bt = await getTranslations("breadcrumb");

  return (
    <div className="mx-auto max-w-3xl px-5 pt-12 pb-20 md:px-6 md:pt-24 md:pb-40">
      <div className="flex flex-col gap-12 md:gap-16">
        {/* Top: breadcrumb + title (変A Reading Column / Top) */}
        <div className="flex flex-col gap-5 md:gap-6">
          <Breadcrumb
            items={[
              { label: bt("home"), href: "/" },
              { label: t("terms") },
            ]}
          />
          <h1>{t("terms")}</h1>
        </div>

        {/* Clauses (変A Reading Column / Clauses) */}
        <div className="flex flex-col gap-8 md:gap-12">
          <Section title="第1条（適用）">
            <p>
              本利用規約（以下「本規約」）は、株式会社elxea（以下「当社」）が運営するウェブサイト「elxea」
              （以下「本サイト」）の利用に関する条件を定めるものです。
              本サイトをご利用いただくことにより、本規約に同意したものとみなします。
            </p>
          </Section>

          <Section title="第2条（定義）">
            <ul className="list-disc space-y-1 pl-5">
              <li>「会員」とは、当社が定める手続きに従い会員登録を行った方をいいます。</li>
              <li>「定期便」とは、当社が提供する商品の定期購入サービスをいいます。</li>
              <li>「コンテンツ」とは、本サイトに掲載されるテキスト、画像、動画等の情報をいいます。</li>
            </ul>
          </Section>

          <Section title="第3条（会員登録）">
            <p>
              会員登録はShopifyアカウントを通じて行います。登録情報は正確かつ最新のものを
              ご入力ください。登録情報に変更があった場合は、速やかに更新してください。
            </p>
          </Section>

          <Section title="第4条（定期便の契約）">
            <ol className="list-decimal space-y-2 pl-5">
              <li>定期便の契約は、お客様が本サイトで申込手続きを完了し、当社がこれを承諾した時点で成立します。</li>
              <li>定期便の価格、お届け頻度、内容は、各商品ページに記載の通りとします。</li>
              <li>当社は、やむを得ない事由がある場合、事前に通知の上、定期便の内容を変更することがあります。</li>
            </ol>
          </Section>

          <Section title="第5条（定期便の解約）">
            <ol className="list-decimal space-y-2 pl-5">
              <li>定期便はいつでも解約可能です。マイページから手続きいただけます。</li>
              <li>次回発送日の3日前までに解約手続きを完了してください。期日を過ぎた場合、次回分の発送後に解約が適用されます。</li>
              <li>解約後も、既に決済済みの商品はお届けいたします。</li>
            </ol>
          </Section>

          <Section title="第6条（禁止事項）">
            <p>お客様は、以下の行為を行ってはなりません。</p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>法令又は公序良俗に反する行為</li>
              <li>当社又は第三者の知的財産権を侵害する行為</li>
              <li>本サイトの運営を妨害する行為</li>
              <li>他のユーザーになりすます行為</li>
              <li>商品の転売を目的とした購入</li>
              <li>その他、当社が不適切と判断する行為</li>
            </ul>
          </Section>

          <Section title="第7条（知的財産権）">
            <p>
              本サイトに掲載されるコンテンツの知的財産権は、当社又は正当な権利者に帰属します。
              無断での複製、転載、改変等を禁止します。
            </p>
          </Section>

          <Section title="第8条（免責事項）">
            <ol className="list-decimal space-y-2 pl-5">
              <li>当社は、本サイトの内容の正確性、完全性、有用性等について、いかなる保証も行いません。</li>
              <li>当社は、本サイトの利用により生じた損害について、当社に故意又は重過失がある場合を除き、責任を負いません。</li>
              <li>天災地変、通信障害その他の不可抗力により生じた損害については、当社は責任を負いません。</li>
            </ol>
          </Section>

          <Section title="第9条（準拠法・管轄）">
            {/* TODO(release-gate): 実値確定待ち */}
            <p>
              本規約の解釈にあたっては日本法を準拠法とし、本規約に関する紛争については、
              [管轄裁判所]を第一審の専属的合意管轄裁判所とします。
            </p>
          </Section>
        </div>

        {/* Meta (変A Reading Column / Meta) */}
        <div className="flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground">
          <p>制定日：2026年3月1日</p>
          <p>株式会社elxea</p>
        </div>
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
    <section className="flex flex-col gap-3">
      <h2 className="text-foreground">{title}</h2>
      <div className="text-base leading-relaxed text-foreground">{children}</div>
    </section>
  );
}
