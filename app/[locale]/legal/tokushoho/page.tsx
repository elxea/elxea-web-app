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
 * 本ページの法定表記 (運営統括責任者 / 所在地 / 電話番号 / メール) は 2026-08-10 に
 * 実値へ差し替え済み (`status: "confirmed"`)。値の SoT は Notion の Corporate Info DB で、
 * 利用規約 S4 (7850:799) にあった所在地の不一致も同じレジストリ参照に寄せて解消した。
 * 以後もここに直書きせず `lib/placeholders.ts` 経由でのみ読むこと (SoT を二重化しない)。
 *
 * S4 の受付時間は仮値扱いにしていないが、特商法 第11条は実際に連絡が取れる窓口の記載を
 * 求めるため、その時間帯で受電できるかの確認は未了 (台帳の Open items 3)。
 *
 * ## 群 IV (定期便について) — 2026-08-11 追加
 *
 * 定期便 (Shopify selling plan による継続課金) を売る時点で、法11条・施行規則23条の
 * 表示事項に「定期便である旨 / 各回の分量・代金 / 支払時期 / 引渡時期 / 解約条件」が
 * 加わる。追加前の本ページは単発販売しか書いておらず、その全部が欠落していた。
 *
 * 文面は自分で書き起こしていない。法務起草の確定文面 (IV-1〜IV-9) をそのまま写している
 * (copy-as-data)。言い回しを変えたくなったら、まず起草側を直すこと。
 * 正本: https://app.notion.com/p/3b870c9d064c8173b866f824f95f36fa
 *
 * 群を 1 か所に固めるのは意図的。分散させると「引渡時期や分量等の表示が定期便のもので
 * あると認識し難い」状態 (消費者庁ガイドライン別添9 2(2)) になる。
 *
 * 起草の 【要値確定】 のうち、Setaka が 2026-08-11 に確定した 4 点は埋めた
 * (定期便の送料無料 / 初回1,880円・継続2,280円 / 初回はご注文から5営業日以内に発送 /
 * 解約はマイページを主としLINE・メールを補助)。残る 5 点は Shopify の設定・実測に
 * 依存するため `lib/placeholders.ts` の仮値ガードに載せてある。
 *
 * `PLACEHOLDER_MARKER` が 1 件でも残る間は production 相当のビルド / テストが機械的に
 * 落ちる設計なので、本ページは現状のままでは公開できない (それが正しい状態)。
 * 内訳は lib/placeholders.ts / 台帳 `docs/placeholders.md` を見ること。
 */

const OPERATIONS_MANAGER = placeholderValue("tokushoho.operationsManager");
const ADDRESS = placeholderValue("tokushoho.address");
const PHONE = placeholderValue("tokushoho.phone");
const EMAIL = placeholderValue("tokushoho.email");

/* 群 IV の未確定値 (Shopify の設定・実測待ち)。差し替えは lib/placeholders.ts で行う。 */
const SUB_PAYMENT_METHODS = placeholderValue("tokushoho.subscriptionPaymentMethods");
const SUB_FIRST_CHARGE = placeholderValue("tokushoho.subscriptionFirstChargeTiming");
const SUB_RECURRING_CHARGE = placeholderValue("tokushoho.subscriptionRecurringChargeTiming");
const SUB_CANCEL_CUTOFF = placeholderValue("tokushoho.subscriptionCancelCutoff");
const SUB_EDITABLE_FIELDS = placeholderValue("tokushoho.subscriptionEditableFields");

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
          "ご注文から5営業日以内に発送します。予約商品は、商品ページに記載の時期に発送します。",
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
  {
    id: "IV",
    heading: "IV  定期便について",
    items: [
      {
        label: "契約の形態と契約期間",
        value:
          "定期便は、お客様から停止・解約のお申し出をいただくまで、お選びいただいた間隔で商品を継続してお届けする契約です。契約期間の定めはなく、お申し出がないかぎり自動で更新されます。最低購入回数の定めはありませんので、いつでも停止・解約いただけます。",
      },
      {
        label: "お届けの間隔と各回の分量",
        value:
          "お届け間隔は、毎月・2か月ごと・3か月ごとの3つからお選びいただけます。各回にお届けする商品と分量は、お申し込みいただくコースの商品ページに記載しています。契約期間の定めがないため、お届けの総回数はあらかじめ定まりません。1年間ご継続いただいた場合のお届け回数の目安は、毎月コースで12回、2か月ごとコースで6回、3か月ごとコースで4回です。いずれも目安であり、お届け回数を約束するものではありません。",
      },
      {
        label: "各回の代金",
        value:
          "毎月コースの代金は、初回1,880円（税込）、2回目以降は毎回2,280円（税込）です。初回の価格が適用されるのは初回のお届け分のみで、2回目以降は通常価格になります。2か月ごとコース・3か月ごとコースの代金は、各コースの商品ページに、初回の価格と2回目以降の価格を並べて記載しています。定期便の配送料は無料です。商品代金のほかにお支払いいただく料金はありません。契約期間の定めがないため支払総額は定まりませんが、目安として、毎月コースを1年間ご継続いただいた場合の商品代金の合計は26,960円（税込）です。これは初回1,880円と2回目以降2,280円×11回を合計した目安の金額です。",
      },
      {
        label: "お支払い方法と時期",
        value: `定期便のお支払い方法は${SUB_PAYMENT_METHODS}です。初回の代金は${SUB_FIRST_CHARGE}に、2回目以降の代金は${SUB_RECURRING_CHARGE}に、ご登録の決済手段へ自動で請求します。`,
      },
      {
        label: "各回のお届け時期",
        value:
          "初回は、お申し込みから5営業日以内に発送します。2回目以降は、お申し込み日を起点として、お選びいただいた間隔ごとに発送します。発送からお届けまでの日数は、配送地域により異なります。",
      },
      {
        label: "停止・解約の方法",
        value: `マイページ（アカウント）から、いつでもお客様ご自身で停止・解約の手続きができます。お電話やご来店は不要で、手数料はいただきません。次回お届け分を止める場合は、次回発送予定日の${SUB_CANCEL_CUTOFF}までに手続きをお願いします。この期限を過ぎたお手続きは、その次の回から反映されます。マイページの操作でお困りのときは、LINE公式アカウントのお問い合わせ窓口、またはメールでもご相談を承ります。`,
      },
      {
        label: "中途解約したときの取扱い",
        value:
          "契約期間の定めがないため、解約にともなう違約金・解約手数料はいただきません。ただし、すでに発送手続きに入った回は、キャンセルを承れません。初回の特別価格でお受け取りになったあとに解約された場合も、差額の返還を求めることはありません。",
      },
      {
        label: "定期便の返品・交換",
        value:
          "定期便でお届けした商品も、単発のご注文と同じ条件で返品・交換を承ります。未開封の商品にかぎり、商品到着後8日以内にお問い合わせからご連絡ください。お客様のご都合による返品の送料はお客様のご負担、品違い・破損による返品・交換は当方の負担です。この8日間は、各回のお届けごとに計算します。",
      },
      {
        label: "お申し込み内容の変更",
        value: `お届け間隔・お届け先・お支払い方法の変更は${SUB_EDITABLE_FIELDS}です。マイページから手続きできない項目は、お問い合わせ窓口へご連絡ください。`,
      },
    ],
  },
];

const NOTES = [
  "価格・送料・お届け日は、ご注文確認画面で確定した金額と日付をご確認いただけます。",
  "返品・交換のご相談は、まずお問い合わせからご連絡ください。状況をうかがったうえでご案内します。",
  "この表記は、特定商取引法 第11条にもとづく通信販売の広告表示です。",
  "定期便（継続してお届けするお申し込み）の条件は、「定期便について」の欄にまとめています。",
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
