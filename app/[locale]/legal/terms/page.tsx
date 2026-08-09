import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Breadcrumb } from "@/components/seo/breadcrumb";
import { Section } from "@/components/layout/container";
import {
  ChapterBreak,
  MetaRow,
  Note,
  Overline,
  bodySmClass,
} from "@/components/editorial/rule-list";

/**
 * 利用規約 — Figma 確定レイアウト `Common / Layouts` section 7848:39101
 * (PC 7848:39102 / SP 7848:39103) の実装。
 *
 * S1 見出し (名乗り左 / 規約メタ右) / S2 規約本文 (PC は左 sticky 目次 col1-3 +
 * 右 本文 col5-10 測度 640) / S3 章切り / S4 事業者情報 の 4 ブロック構成。
 *
 * 規約本文は法的文書のため、翻訳を実装側で創作せず **Figma の日本語正文をそのまま**
 * 置く (旧実装も同様に日本語のみを直書きしており、ロケール切替をしていない)。
 * 英語版が必要になった時点で、法務レビューを経た訳文を別途用意する。
 */

/** 目次の群。Figma 7848:39526 / 39533 / 39545 / 39552。 */
const GROUPS = [
  { id: "I", label: "I  はじめに", from: 1, to: 3 },
  { id: "II", label: "II  アカウントとご注文", from: 4, to: 11 },
  { id: "III", label: "III  イベント・投稿・個人情報", from: 12, to: 14 },
  { id: "IV", label: "IV  禁止事項と免責", from: 15, to: 19 },
] as const;

/** 全 19 条。正本は Figma 7849:39283 (規約本文 col5-10)。 */
const ARTICLES: { no: number; title: string; body: string[] }[] = [
  {
    no: 1,
    title: "定義",
    body: [
      "本規約において、次の用語は、次の各号にそれぞれ定める意味で用いるものとします。",
      "（1）「本サービス」とは、当社が運営する roji および関連する一切のサービスをいいます。",
      "（2）「会員」とは、第4条に基づき登録手続きを完了した個人をいいます。",
      "（3）「商品」とは、本サービスを通じて当社が販売する茶葉その他の物品をいいます。",
    ],
  },
  {
    no: 2,
    title: "規約の適用範囲および変更",
    body: [
      "本規約は、本サービスの利用に関して当社と会員との間に生じる一切の関係に適用されます。",
      "当社は、必要と判断した場合、本規約を変更することがあります。変更後の内容は、本サービス上に掲示した時点から効力を生じます。",
    ],
  },
  {
    no: 3,
    title: "本サービスの内容",
    body: [
      "本サービスは、茶葉の販売、定期便のお届け、読み物の配信、イベントのご案内、および会員ご自身の記録機能によって構成されます。",
      "当社は、これらの内容を予告なく追加または変更することがあります。",
    ],
  },
  {
    no: 4,
    title: "会員登録",
    body: [
      "本サービスの一部の機能は、会員登録を行った方に限りご利用いただけます。",
      "登録の際は、正確かつ最新の情報をご提供ください。虚偽の情報が判明した場合、登録をお断りすることがあります。",
    ],
  },
  {
    no: 5,
    title: "アカウントの管理",
    body: [
      "会員は、自己の責任においてアカウント情報を管理するものとします。",
      "第三者による不正な利用が疑われる場合は、速やかに当社までご連絡ください。",
    ],
  },
  {
    no: 6,
    title: "商品の注文",
    body: [
      "商品のご注文は、本サービス上の所定の手続きにより行われるものとします。",
      "当社が注文確認の通知を発信した時点をもって、売買契約が成立します。",
    ],
  },
  {
    no: 7,
    title: "商品の配送",
    body: [
      "商品は、会員が指定した配送先へお届けします。",
      "天候、交通事情その他やむを得ない事由により、お届けが遅れることがあります。",
    ],
  },
  {
    no: 8,
    title: "お支払い",
    body: [
      "商品代金および送料のお支払い方法は、本サービス上に表示するところによります。",
      "決済に関する条件は、各決済事業者の定めに従うものとします。",
    ],
  },
  {
    no: 9,
    title: "定期便",
    body: [
      "定期便は、会員が選択した周期で商品をお届けするサービスです。",
      "スキップ、休止および解約は、会員がいつでもマイページから行うことができます。手数料はいただきません。",
    ],
  },
  {
    no: 10,
    title: "商品の返品・交換",
    body: [
      "商品に不良または誤配送があった場合は、到着後7日以内にご連絡ください。",
      "当社の負担により、返品または交換の対応をいたします。",
    ],
  },
  {
    no: 11,
    title: "注文のキャンセル",
    body: [
      "発送準備の開始前であれば、ご注文のキャンセルを承ります。",
      "発送後のキャンセルはお受けできません。",
    ],
  },
  {
    no: 12,
    title: "イベントへのお申し込み",
    body: [
      "イベントへのお申し込みは、各イベントページに定める条件に従うものとします。",
      "定員、開催の可否および取消の取扱いは、イベントごとに定めます。",
    ],
  },
  {
    no: 13,
    title: "投稿および記録の取扱い",
    body: [
      "会員が本サービスに記録した内容に関する権利は、会員に帰属します。",
      "当社は、本サービスの提供および改善に必要な範囲に限り、これを利用することがあります。",
    ],
  },
  {
    no: 14,
    title: "個人情報の取扱い",
    body: ["当社は、会員の個人情報を、別途定めるプライバシーポリシーに従って取り扱います。"],
  },
  {
    no: 15,
    title: "禁止事項",
    body: [
      "会員は、本サービスの利用にあたり、次の行為を行ってはなりません。",
      "（1）法令または公序良俗に反する行為",
      "（2）当社または第三者の権利を侵害する行為",
      "（3）本サービスの運営を妨げる行為",
    ],
  },
  {
    no: 16,
    title: "会員資格の停止および抹消",
    body: [
      "会員が本規約に違反した場合、当社は、事前の通知なく会員資格の停止または抹消を行うことがあります。",
    ],
  },
  {
    no: 17,
    title: "本サービスの中断・終了",
    body: [
      "当社は、システムの保守、障害その他やむを得ない事由により、本サービスの全部または一部を一時的に中断することがあります。",
    ],
  },
  {
    no: 18,
    title: "免責および責任の範囲",
    body: [
      "当社は、本サービスの利用により会員に生じた損害について、当社の故意または重大な過失による場合を除き、責任を負わないものとします。",
    ],
  },
  {
    no: 19,
    title: "準拠法および合意管轄",
    body: [
      "本規約の準拠法は日本法とします。",
      "本サービスに関して紛争が生じた場合、東京地方裁判所を第一審の専属的合意管轄裁判所とします。",
    ],
  },
];

const PREAMBLE =
  "この利用規約（以下「本規約」といいます）は、株式会社elxea（以下「当社」といいます）が運営する roji（以下「本サービス」といいます）のご利用条件を定めるものです。本サービスをご利用いただいた場合、本規約にご同意いただいたものとみなします。";

const META = [
  { label: "制定日", value: "2026年4月1日" },
  { label: "最終改定日", value: "2026年8月5日" },
  { label: "適用範囲", value: "roji のすべてのサービス" },
  { label: "事業者", value: "株式会社elxea" },
];

const BUSINESS = [
  { label: "事業者名", value: "株式会社elxea / elxea Inc." },
  { label: "所在地", value: "東京都千代田区平河町2-5-3 Nagatacho GRID 5F" },
  { label: "お問い合わせ", value: "info@elxea.com" },
  { label: "改定履歴", value: "2026年8月5日 改定　／　2026年4月1日 制定" },
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: t("terms") };
}

export default async function TermsPage() {
  const t = await getTranslations("legal");
  const bt = await getTranslations("breadcrumb");

  return (
    <>
      {/* S1 ページ見出し — 名乗り左 / 規約メタ右 (Figma 7848:39266) */}
      <Section spacing="none" className="pt-10 pb-8">
        {/* Figma の breadcrumb は「ホーム / お問い合わせ」だが、これは他ページからの
            流用ミス。正しい現在地を出す (Figma 側の文言バグとして申し送り済み) */}
        <Breadcrumb
          items={[{ label: bt("home"), href: "/" }, { label: t("terms") }]}
        />
        <div className="mt-10 lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <Overline>TERMS OF SERVICE</Overline>
            <h1 className="mt-4">{t("terms")}</h1>
            <p className={`${bodySmClass} mt-6 text-muted-foreground`}>
              roji をご利用いただくうえでの取り決めです。全19条、すべてこのページに置いています。
            </p>
          </div>
          <div className="mt-12 lg:col-span-5 lg:col-start-8 lg:mt-0">
            <Note>この規約について</Note>
            {/* Figma 7848:39271 系は罫線を持たない */}
            <dl className="mt-3">
              {META.map((row) => (
                <MetaRow key={row.label} label={row.label} divider={false}>
                  {row.value}
                </MetaRow>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      {/* S2 規約本文 — PC は左 sticky 目次 (col1-3) + 右 本文 (col5-10 / 測度 640) */}
      <Section spacing="none" className="pt-24 pb-8">
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          <nav
            aria-label="目次"
            className="lg:col-span-3 lg:sticky lg:top-24 lg:self-start"
          >
            <Overline>CONTENTS</Overline>
            <div className="mt-10 border-b border-border">
              {GROUPS.map((group) => (
                <div key={group.id} className="border-t border-border pt-3 pb-4">
                  <p className={`${bodySmClass} text-muted-foreground`}>{group.label}</p>
                  <ul className="mt-2">
                    {ARTICLES.filter((a) => a.no >= group.from && a.no <= group.to).map(
                      (article) => (
                        <li key={article.no}>
                          <a
                            href={`#article-${article.no}`}
                            /* SP は行全体を 44px のタップ域にする (Figma 7851:39869) */
                            className={`${bodySmClass} flex min-h-11 items-center text-foreground hover:text-muted-foreground lg:min-h-0 lg:py-1`}
                          >
                            {`第${article.no}条　${article.title}`}
                          </a>
                        </li>
                      )
                    )}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <div className="mt-12 lg:col-span-6 lg:col-start-5 lg:mt-0">
            <p className={`${bodySmClass} text-foreground`}>{PREAMBLE}</p>
            <hr className="mt-12 border-border" />
            <div className="mt-12 flex flex-col gap-12">
              {ARTICLES.map((article) => (
                <section key={article.no} id={`article-${article.no}`}>
                  <h2
                    className={
                      "[font:var(--typography-style-h4)] [letter-spacing:var(--typography-style-h4-tracking)] text-foreground"
                    }
                  >
                    {`第${article.no}条（${article.title}）`}
                  </h2>
                  <div className={`${bodySmClass} mt-4 text-foreground`}>
                    {article.body.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* S3 章切り — キッカー無し版 (Figma 7850:796) */}
      <ChapterBreak title="わかりにくいところは、そのままにしないでください。">
        この規約について、ご不明な点はお問い合わせから承ります。
      </ChapterBreak>

      {/* S4 事業者情報・お問い合わせ (Figma 7850:799) */}
      <Section spacing="none" className="pt-24 pb-12">
        {/* C17-1: 節見出しに `legal-section-title` スロットを先行適用する。
            この節はプライバシー S4 (7851:39869 系) と同じ「事業者情報・お問い合わせ」で、
            **条見出し (`第N条` = h2) の上位**にあたる節。プライバシー側では素の `<h3>` が
            条 (h2) より下のタグなのに文字が大きい **見出しレベルの逆転**を起こしていて、
            C10-1 で `legal-section-title` (要素は h2 / 体裁は素の h3 と同値) に是正済み。

            利用規約側は現在 条見出しが 24px で描かれているため逆転が表に出ていないが、
            条見出しを Figma どおり 24px 化する改修が入った時点で同じ逆転が再発する。
            **体裁は 1px も変えず**要素とスロットだけ先に揃えておく
            (globals.css の `legal-section-title` は `font: h3` + `line-height: 1.3` で、
            素の `<h3>` = h3 トークン + `:lang(ja) h3 { line-height: 1.3 }` と同値)。
            c10-1 確認事項 12 の申し送りをここで閉じる。 */}
        <h2 data-slot="legal-section-title">この規約に関するお問い合わせ</h2>
        <p className={`${bodySmClass} mt-4 max-w-160 text-muted-foreground`}>
          本規約の内容についてのご質問は、下記までお寄せください。
        </p>
        <dl className="mt-8 border-b border-border">
          {BUSINESS.map((row) => (
            <MetaRow key={row.label} label={row.label} labelWidth="wide">
              {row.value}
            </MetaRow>
          ))}
        </dl>
      </Section>
    </>
  );
}
