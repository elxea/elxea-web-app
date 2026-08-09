import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import {
  ChapterBreak,
  LinkRow,
  MetaRow,
  Note,
  Overline,
  PairRow,
  bodySmClass,
  h4Class,
} from "@/components/editorial/rule-list";
import { placeholderValue } from "@/lib/placeholders";
import { cn } from "@/lib/utils";
import { ContactForm } from "./contact-form";

/**
 * お問い合わせ — Figma【R2: 確定版】section `8109:46652`
 * (PC `8109:46653` / SP `8109:46734`)。
 *
 * ## R2 で 1 ページに統合された
 *
 * R1 は「お問い合わせ (一般)」と「お問い合わせ:法人」の 2 ページ構成だったが、
 * R2 確定版はフレーム名のとおり **Common 静的 1 ページ**で、法人・取材は
 * `お問い合わせの種類` の選択肢として吸収されている。根拠は Figma 実測:
 * - S1 リード `8109:46659` = 「ご質問、お気づきのこと、**取材や卸のご相談まで**、こちらで承ります。」
 * - 種類 field の注記 `8109:46695` = 「お客様のお問い合わせ / **お取引・取材等のご相談**」
 * - Common ページ (`7567:12`) 全数走査で法人専用の R2 フレームは存在しない
 *
 * よって `/contact/business` は本ページへの恒久リダイレクトにした
 * (既存の被リンク・ブックマークを切らないため。ページ削除はしていない)。
 * 送信先メールボックスの振り分け (一般 = CONTACT_TO_EMAIL / 法人 =
 * CONTACT_BUSINESS_TO_EMAIL) は R1 の挙動を保ったまま `category` で
 * サーバ側に移した (`app/api/contact/route.ts`)。
 *
 * ## 構成 (4 ブロック)
 *
 * S1 ページ見出し (左 = 名乗り col1-5 / 右 = 期待値メタ col8-12) /
 * S2 お問い合わせの前に (自己解決の導線・罫線リスト) /
 * S3 フォーム (左 = 測度 640 col1-6 / 右 = 補助メタ col8-12) /
 * S4 章切り (明度反転)。
 *
 * 生 px・生カラーは書かない。寸法は Tailwind spacing scale、文字組みは
 * `typography.style.*` トークン (editorial/rule-list 経由) のみを使う。
 */

/** S1 右カラム。Figma `8109:46661`〜`8109:46670` の 4 行。 */
const META_KEYS = [
  { label: "metaReply", value: "metaReplyValue" },
  { label: "metaFormHours", value: "metaFormHoursValue" },
  // メールは Figma が「value (ダミーアドレス)」と明記しており実値未確定。
  // 特商法ページと同じ仮値レジストリから読む (直書き禁止・本番ビルドで機械的に止まる)。
  { label: "metaEmail", value: null },
  { label: "metaPhone", value: "metaPhoneValue" },
] as const;

/** S2 自己解決の導線。Figma `8109:46676` / `8109:46680` / `8109:46684`。 */
const BEFORE_LINKS = [
  { href: "/faq", title: "beforeFaq", desc: "beforeFaqDesc" },
  { href: "/shipping", title: "beforeShipping", desc: "beforeShippingDesc" },
  {
    href: "/account/subscriptions",
    title: "beforeSubscription",
    desc: "beforeSubscriptionDesc",
  },
] as const;

/** S3 右カラム。Figma `8109:46720` / `8109:46723` / `8109:46726`。 */
const HINTS = [
  { term: "hintOrder", desc: "hintOrderDesc" },
  { term: "hintProduct", desc: "hintProductDesc" },
  { term: "hintSituation", desc: "hintSituationDesc" },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contact");
  return { title: t("title"), description: t("lead") };
}

export default async function ContactPage() {
  const t = await getTranslations("contact");
  const bt = await getTranslations("breadcrumb");
  const email = placeholderValue("tokushoho.email");

  return (
    <>
      {/* S1 ページ見出し — Figma 8109:46655 (h332 / breadcrumb y40 / kicker y96) */}
      <Section spacing="none" className="pt-10 pb-8">
        <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: t("title") }]} />
        <div className="mt-10 lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <Overline>{t("overline")}</Overline>
            <h1 className="mt-4">{t("title")}</h1>
            <p className={cn(bodySmClass, "mt-6 text-muted-foreground")}>{t("lead")}</p>
          </div>
          <div className="mt-12 lg:col-span-5 lg:col-start-8 lg:mt-0">
            <Note>{t("metaHeading")}</Note>
            <dl className="mt-3 border-b border-border">
              {META_KEYS.map((row) => (
                <MetaRow key={row.label} label={t(row.label)}>
                  {row.value ? t(row.value) : email}
                </MetaRow>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      {/* S2 お問い合わせの前に — Figma 8109:46673 (見出し y96 / 行 h72) */}
      <Section spacing="none" className="pt-24 pb-8">
        <h2 data-slot="section-title">{t("beforeHeading")}</h2>
        <p className={cn(bodySmClass, "mt-3 max-w-160 text-muted-foreground")}>
          {t("beforeLead")}
        </p>
        <div className="mt-2 border-b border-border">
          {BEFORE_LINKS.map((link) => (
            <LinkRow key={link.href} href={link.href} title={t(link.title)}>
              {t(link.desc)}
            </LinkRow>
          ))}
        </div>
      </Section>

      {/* S3 フォーム — Figma 8109:46688 (左 測度 640 / 右 副カラム 528) */}
      <Section spacing="none" className="pt-24 pb-12">
        <h2 data-slot="section-title">{t("formHeading")}</h2>
        <p className={cn(bodySmClass, "mt-3 max-w-160 text-muted-foreground")}>
          {t("formLead")}
        </p>
        <div className="mt-12 lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-6">
            <ContactForm />
          </div>
          <div className="mt-16 lg:col-span-5 lg:col-start-8 lg:mt-0">
            {/* 16px の列見出し。DS に 16px の見出しスロットが無いため
                h4 スケールを `<p>` に当てる (DisclosureRow の question と同じ作法)。 */}
            <p className={cn(h4Class, "text-foreground")}>{t("hintsHeading")}</p>
            <dl className="mt-6 border-b border-border">
              {HINTS.map((hint) => (
                <PairRow key={hint.term} term={t(hint.term)} tone="quiet" layout="narrow">
                  {t(hint.desc)}
                </PairRow>
              ))}
            </dl>
            <Note className="mt-7">{t("hintsNote")}</Note>
          </div>
        </div>
      </Section>

      {/* S4 章切り — Figma 8109:46730 (キッカー無し版) */}
      <ChapterBreak title={t("chapterTitle")}>{t("chapterBody")}</ChapterBreak>
    </>
  );
}
