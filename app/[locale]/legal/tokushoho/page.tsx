import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import { placeholderValue } from "@/lib/placeholders";
import {
  ChapterBreak,
  MetaRow,
  Note,
  Overline,
  StackItem,
  bodySmClass,
} from "@/components/editorial/rule-list";

/**
 * 特定商取引法に基づく表記 — Figma 確定レイアウト
 * `Common / Layouts` section 7855:843 (PC 7855:844 / SP 7855:845)。
 *
 * S1 見出し + 販売者 / S2 記載事項 (左 col1-6 測度640 + 右 col8-12 読むまえに) /
 * S3 章切り / S4 お問い合わせ窓口 の 4 ブロック構成。
 * 記載事項は Figma の指定どおり **罫線ゼロ**、群は余白量の差だけで切る。
 *
 * 規約と同じく法的文書のため、英訳は実装側で創作しない (日本語正文のみ)。
 *
 * ！重要 — 公開前に実値の確認が必要
 * 法定表記の一部 (所在地 / 電話番号 / 運営統括責任者氏名 / 問い合わせメール) は
 * まだ事業側の確定を待っている。特商法 第11条の表示義務を満たさないため、
 * **この値のまま公開してはならない**。
 *
 * 仮値は本ファイルに直書きせず `lib/placeholders.ts` のレジストリに集約し、
 * `PLACEHOLDER_MARKER` を付けている。マーカーが残ったまま production 相当の
 * 環境でビルド / テストすると機械的に落ちる (詳細は lib/placeholders.ts)。
 * 差し替え台帳は `docs/placeholders.md`。
 *
 * また利用規約 S4 (7850:799) は所在地に別の値を載せており不一致がある。
 * どちらを正とするかは事業側の確認事項 (台帳の Open items に記載)。
 */

const OPERATIONS_MANAGER = placeholderValue("tokushoho.operationsManager");
const ADDRESS = placeholderValue("tokushoho.address");
const PHONE = placeholderValue("tokushoho.phone");
const EMAIL = placeholderValue("tokushoho.email");

const SELLER: { label: string; value: string }[] = [
  { label: "販売業者", value: "株式会社elxea" },
  { label: "運営統括責任者", value: OPERATIONS_MANAGER },
  { label: "所在地", value: ADDRESS },
  { label: "連絡先", value: `${EMAIL} ／ ${PHONE}` },
];

const GROUPS: { id: string; heading: string; items: { label: string; value: string }[] }[] = [
  {
    id: "I",
    heading: "I  代金について",
    items: [
      {
        label: "販売価格",
        value: "各商品ページに表示している金額です。表示価格はすべて消費税込みです。",
      },
      {
        label: "商品代金以外に必要な料金",
        value:
          "配送料、代金引換手数料、銀行振込手数料がかかります。いずれもご注文確認画面で確定金額をご確認いただけます。",
      },
      {
        label: "お支払い方法",
        value: "クレジットカード、コンビニ決済、銀行振込、代金引換。",
      },
      {
        label: "お支払い時期",
        value:
          "クレジットカードはご注文時に確定します。コンビニ決済・銀行振込は、ご注文から7日以内にお支払いください。",
      },
    ],
  },
  {
    id: "II",
    heading: "II  お届けについて",
    items: [
      {
        label: "引渡し時期",
        value:
          "ご注文から3営業日以内に発送します。予約商品は、商品ページに記載の時期に発送します。",
      },
      {
        label: "配送方法",
        value: "宅配便でお届けします。お届け日時のご指定は、ご注文時に承ります。",
      },
      { label: "販売数量", value: "商品ページに記載のない場合、数量の制限はありません。" },
    ],
  },
  {
    id: "III",
    heading: "III  返品・交換について",
    items: [
      {
        label: "返品・交換の可否",
        value:
          "未開封の商品にかぎり、お客様のご都合による返品を承ります。茶葉は、開封後の返品を承れません。品違い・破損の場合は、開封後でも交換いたします。",
      },
      { label: "返品期限", value: "商品到着後8日以内に、お問い合わせからご連絡ください。" },
      {
        label: "返品送料",
        value:
          "お客様のご都合による返品はお客様のご負担、品違い・破損による返品・交換は当方の負担です。",
      },
    ],
  },
];

const NOTES = [
  "価格・送料・お届け日は、ご注文確認画面で確定した金額と日付をご確認いただけます。",
  "返品・交換のご相談は、まずお問い合わせからご連絡ください。状況をうかがったうえでご案内します。",
  "この表記は、特定商取引法 第11条にもとづく通信販売の広告表示です。",
];

const RELATED = [
  { label: "配送について", href: "/shipping" },
  { label: "利用規約", href: "/legal/terms" },
  { label: "お問い合わせ", href: "/contact" },
];

const DESK = [
  { label: "受付時間", value: "平日 11:00–17:00（土日祝を除く）" },
  { label: "メール", value: EMAIL },
  { label: "電話", value: PHONE },
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: t("tokushoho") };
}

export default async function TokushohoPage() {
  const t = await getTranslations("legal");
  const bt = await getTranslations("breadcrumb");

  return (
    <>
      {/* S1 ページ見出し + 販売者 (Figma 7856:927) */}
      <Section spacing="none" className="pt-10 pb-8">
        <Breadcrumb
          items={[{ label: bt("home"), href: "/" }, { label: t("tokushoho") }]}
        />
        <div className="mt-10 lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <Overline>LEGAL NOTICE</Overline>
            <h1 className="mt-4">{t("tokushoho")}</h1>
            <p className={`${bodySmClass} mt-6 text-muted-foreground`}>
              roji でのお買いものについて、法律で定められた事項を記載しています。言い回しは実際の運用に合わせ、わかりにくい表現は避けました。
            </p>
          </div>
          <div className="mt-12 lg:col-span-5 lg:col-start-8 lg:mt-0">
            <Note>販売者</Note>
            {/* Figma 7856:932 系は罫線を持たない */}
            <dl className="mt-3">
              {SELLER.map((row) => (
                <MetaRow key={row.label} label={row.label} divider={false}>
                  {row.value}
                </MetaRow>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      {/* S2 記載事項 — 左 col1-6 (測度640) / 右 col8-12 読むまえに (Figma 7857:927) */}
      <Section spacing="none" className="pt-24 pb-8">
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          {/* 罫線ゼロ。群は余白量の差 (項目 32 / 群 96) だけで切る */}
          <div className="flex flex-col gap-24 lg:col-span-6">
            {GROUPS.map((group) => (
              <section key={group.id}>
                <h3>{group.heading}</h3>
                <dl className="mt-6 flex flex-col gap-8">
                  {group.items.map((item) => (
                    <StackItem key={item.label} label={item.label}>
                      {item.value}
                    </StackItem>
                  ))}
                </dl>
              </section>
            ))}
          </div>

          {/* SP では読むまえにを記載事項の手前へ繰り上げる (Figma 7858:1107) */}
          <aside className="order-first mb-12 lg:order-none lg:col-span-5 lg:col-start-8 lg:mb-0">
            <Note>読むまえに</Note>
            <div className="mt-6 flex flex-col gap-6">
              {NOTES.map((note) => (
                <p key={note} className={`${bodySmClass} text-foreground`}>
                  {note}
                </p>
              ))}
            </div>
            <hr className="mt-12 border-border" />
            <div className="mt-12">
              <Note>関連するページ</Note>
              <ul className="mt-3 flex flex-col gap-3">
                {RELATED.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`${bodySmClass} text-foreground hover:text-muted-foreground`}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <Note className="mt-12">最終更新日　2026年8月5日</Note>
          </aside>
        </div>
      </Section>

      {/* S3 章切り — キッカー無し版 (Figma 7857:39760) */}
      <ChapterBreak title="書いてあるとおりに、運用しています。">
        記載と異なる対応が必要になったときは、事前に必ずご連絡します。
      </ChapterBreak>

      {/* S4 お問い合わせ窓口 (Figma 7857:39763) */}
      <Section spacing="none" className="pt-24 pb-12">
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-6">
            <Overline>CONTACT</Overline>
            <h3 className="mt-4">確かめたいことがあれば</h3>
            <p className={`${bodySmClass} mt-6 text-muted-foreground`}>
              記載内容についてご不明な点があれば、お問い合わせからご連絡ください。内容によっては、確認にお時間をいただくことがあります。
            </p>
          </div>
          <div className="mt-12 lg:col-span-5 lg:col-start-8 lg:mt-0">
            <Note>お問い合わせ窓口</Note>
            <dl className="mt-3">
              {DESK.map((row) => (
                <MetaRow key={row.label} label={row.label} divider={false}>
                  {row.value}
                </MetaRow>
              ))}
            </dl>
          </div>
        </div>
      </Section>
    </>
  );
}
