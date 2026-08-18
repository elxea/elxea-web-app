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
import { placeholderValue } from "@/lib/placeholders";
import { cn } from "@/lib/utils";

/**
 * プライバシーポリシー
 *
 * ## Figma の正本が無いため兄弟テンプレから導出している
 *
 * roji のプライバシーポリシーには **Figma フレームが 1 枚も無い** (R2 確定版も
 * R1 も無い)。ファイル `AWLnI0XF07e8rScuxPYPc7` の全ノード走査で確認済みで、
 * 存在するのは旧 elxea 世代の変A `6749:15679` (別ブランド・別骨格) だけ。
 *
 * そこで C9-1 と同じ方針で、**同じ legal 群で凍結済みの兄弟テンプレから導出**した。
 * 導出元は 利用規約【採用: 現状案で確定】`Common / Layouts` section `7848:39101`
 * (PC `7848:39102` / SP `7848:39103`) で、実装は
 * `app/[locale]/legal/terms/page.tsx` が同じ骨格を体現している。
 * legal 群のうち「長文条項 + 目次 + 事業者情報」を持つのは利用規約だけなので、
 * 本ページの骨格の正本として最も近い。デザインを新しく発明していない。
 *
 * S1 見出し (名乗り左 / メタ右) / S2 本文 (PC は左 sticky 目次 col1-3 +
 * 右 本文 col5-10 測度 640) / S3 章切り / S4 事業者情報 の 4 ブロック構成。
 *
 * ## 導出元との差分 (いずれも「データが無い節・行は出さない」の適用)
 *
 * - 目次は**群を作らず 8 項のフラット** (利用規約は全 19 条あるため 4 群に束ねている。
 *   8 項に群見出しを与えるのは実在しない構造の捏造になるので作らない)
 * - S1 メタは `制定日` / `事業者` の 2 行のみ (利用規約の `最終改定日` `適用範囲` は
 *   本ポリシーに相当する事実が無いため行ごと出さない)
 * - 前文 (利用規約 PREAMBLE) は置かない (本ポリシーに前文が無い。法的文書の本文を
 *   実装側で創作しない)
 *
 * ## 本文の扱い
 *
 * 条項の文言は R1 実装から**一字も変えずに移設**した (法的文書のため実装側で
 * 起草・要約しない)。第7条の連絡先明細だけはテンプレート側の専用ブロック S4
 * (事業者情報) へ移し、重複表示を避けている (条文本文は不変)。
 *
 * 利用規約・特商法と同じく、英訳は実装側で創作しない (日本語正文のみ)。
 * 法務レビューを経た訳文が用意できた時点で別途対応する。
 *
 * ！所在地は仮値 — `lib/placeholders.ts` の `tokushoho.address` を読む。
 * 特商法ページと同じレジストリなので、実値に差し替わるまで production ビルドは
 * 機械的に止まる (詳細は lib/placeholders.ts / 台帳 docs/placeholders.md)。
 */

const ADDRESS = placeholderValue("tokushoho.address");
/**
 * お問い合わせ先も特商法ページと同じレジストリから読む。以前ここだけ別アドレス
 * (support@) を直書きしており、特商法ページ / お問い合わせページと表示アドレスが
 * 食い違っていた (2026-08-11 に info@ へ統一)。
 */
const EMAIL = placeholderValue("tokushoho.email");

/** 全 8 項。文言は R1 実装 (`app/[locale]/legal/privacy/page.tsx`) の正本を移設。 */
const CLAUSES: {
  no: number;
  title: string;
  body?: string[];
  /** 箇条書き。Figma 利用規約に list 指定は無いが、原文が列挙形式のため保持する。 */
  items?: string[];
  /** 箇条書きの前置き / 後置きの段落。 */
  after?: string[];
}[] = [
  {
    no: 1,
    title: "個人情報の取得",
    body: ["当社は、以下の個人情報を適法かつ公正な手段により取得します。"],
    items: [
      "氏名、メールアドレス、住所、電話番号",
      "注文履歴、お届け先情報",
      "クレジットカード情報（決済代行会社を通じて処理）",
      "サイト閲覧履歴（Cookie等による）",
      "お問い合わせ内容",
    ],
  },
  {
    no: 2,
    title: "利用目的",
    items: [
      "商品の発送およびサービスの提供",
      "ご注文内容の確認、お問い合わせへの対応",
      "定期便の管理（発送スケジュール、決済処理）",
      "新商品・キャンペーン等のご案内（同意いただいた場合）",
      "サイトの改善およびサービス向上のための分析",
    ],
  },
  {
    no: 3,
    title: "第三者提供",
    body: ["当社は、以下の場合を除き、お客様の個人情報を第三者に提供することはありません。"],
    items: [
      "お客様の同意がある場合",
      "法令に基づく場合",
      "配送業者への配送に必要な情報の提供",
      "決済処理のための決済代行会社への提供",
    ],
  },
  {
    no: 4,
    title: "Cookieの利用",
    body: [
      "当サイトでは、お客様の利便性向上およびサイト分析のためにCookieを使用しています。Cookieは、お客様のブラウザ設定により無効にすることが可能です。ただし、Cookieを無効にした場合、一部のサービスがご利用いただけなくなる場合があります。",
      "当サイトで利用するCookieの種類：",
    ],
    items: [
      "必須Cookie：サイトの基本機能、カート、認証に必要",
      "分析Cookie：Google Analytics等によるサイト利用状況の分析",
    ],
  },
  {
    no: 5,
    title: "安全管理措置",
    body: [
      "当社は、個人情報の漏洩、滅失又は毀損の防止のため、適切な安全管理措置を講じます。お客様の認証情報はAES-256-GCMにより暗号化して保存しています。",
    ],
  },
  {
    no: 6,
    title: "個人情報の開示・訂正・削除",
    body: [
      "お客様ご本人から個人情報の開示、訂正、削除のご請求があった場合は、本人確認の上、速やかに対応いたします。下記のお問い合わせ先までご連絡ください。",
    ],
  },
  {
    no: 7,
    title: "お問い合わせ先",
    // 連絡先の明細はテンプレート側の S4 (事業者情報) に置く。条文はここまで。
    body: ["個人情報の取扱いに関するお問い合わせは、以下までご連絡ください。"],
  },
  {
    no: 8,
    title: "改定",
    body: [
      "当社は、必要に応じて本プライバシーポリシーを改定することがあります。改定した場合は、当サイトにて公表いたします。",
    ],
  },
];

/** S1 右カラム。利用規約 `7848:39271` と同じ罫線なしメタ。 */
const META = [
  { label: "制定日", value: "2026年3月1日" },
  { label: "事業者", value: "株式会社elxea" },
];

/** S4 事業者情報。利用規約 `7850:803` と同じラベル幅 (wide = 224)。 */
const BUSINESS = [
  { label: "事業者名", value: "株式会社elxea / elxea Inc." },
  { label: "所在地", value: ADDRESS },
  { label: "お問い合わせ", value: EMAIL },
  { label: "改定履歴", value: "2026年3月1日 制定" },
];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal");
  return { title: t("privacy") };
}

export default async function PrivacyPage() {
  const t = await getTranslations("legal");
  const bt = await getTranslations("breadcrumb");

  return (
    <>
      {/* S1 ページ見出し — 名乗り左 / メタ右 (導出元 利用規約 7848:39266) */}
      <Section spacing="none" className="pt-10 pb-8">
        <Breadcrumb items={[{ label: bt("home"), href: "/" }, { label: t("privacy") }]} />
        <div className="mt-10 lg:grid lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-5">
            <Overline>PRIVACY POLICY</Overline>
            {/* 主見出しは全体裁定 (ページ主見出し = PC 44 / SP 32) に従い共有
                プリセット `.page-title` 経由で当てる。導出元 利用規約 7848:39266 の
                実測は 32 だが、Figma 側に古い値が残っているページ群と同じ扱いで
                全体裁定を優先する (globals.css の `.page-title` 注記 / All Tasks
                ID-7507)。直書きしないのはトークン変更に追従させるため。
                キッカー → h1 の 16 (Figma 15) は据え置き。 */}
            <h1 className="page-title mt-4">{t("privacy")}</h1>
            <p className={cn(bodySmClass, "mt-6 text-muted-foreground")}>
              お客様の個人情報の取扱いについて定めたものです。全8項、すべてこのページに置いています。
            </p>
          </div>
          <div className="mt-12 lg:col-span-5 lg:col-start-8 lg:mt-0">
            <Note>このポリシーについて</Note>
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

      {/* S2 本文 — PC は左 sticky 目次 (col1-3) + 右 本文 (col5-10 / 測度 640) */}
      <Section spacing="none" className="pt-24 pb-8">
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          <nav aria-label="目次" className="lg:col-span-3 lg:sticky lg:top-24 lg:self-start">
            <Overline>CONTENTS</Overline>
            {/* 群を作らずフラットに並べる (8 項のため。導出元との差分はファイル冒頭に記載) */}
            <ul className="mt-10 border-b border-border">
              {CLAUSES.map((clause) => (
                <li key={clause.no} className="border-t border-border">
                  <a
                    href={`#clause-${clause.no}`}
                    /* SP は行全体を 44px のタップ域にする (導出元 7851:39869) */
                    className={cn(
                      bodySmClass,
                      "flex min-h-11 items-center text-foreground hover:text-muted-foreground"
                    )}
                  >
                    {`${clause.no}. ${clause.title}`}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-12 lg:col-span-6 lg:col-start-5 lg:mt-0">
            <div className="flex flex-col gap-12">
              {CLAUSES.map((clause) => (
                <section key={clause.no} id={`clause-${clause.no}`}>
                  {/* 導出元 7849:39287 実測 h24 = h4 スケール (16px)。
                      className だけでは unlayered な `h2{font}` (24px) に負けるため
                      globals.css の `legal-clause-title` スロットで当てる。 */}
                  <h2 data-slot="legal-clause-title" className="text-foreground">
                    {`${clause.no}. ${clause.title}`}
                  </h2>
                  <div className={cn(bodySmClass, "mt-4 text-foreground")}>
                    {clause.body?.map((line) => <p key={line}>{line}</p>)}
                    {clause.items ? (
                      <ul className={cn("list-disc pl-5", clause.body && "mt-3")}>
                        {clause.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* S3 章切り — キッカー無し版 (導出元 7850:796) */}
      <ChapterBreak title="気になるところは、そのままにしないでください。">
        本ポリシーについて、ご不明な点はお問い合わせから承ります。
      </ChapterBreak>

      {/* S4 事業者情報・お問い合わせ (導出元 7850:799) */}
      <Section spacing="none" className="pt-24 pb-12">
        {/* 節見出し。条見出し (16px の h2) より大きい 20px なので、要素も条より
            上位の h2 にする (素の `<h3>` だと「タグは下位・文字は大きい」逆転に
            なる)。体裁は素の h3 と同値のまま (globals.css の
            `legal-section-title` スロット。`section-title` は lh が 29 に動くため
            使わない)。 */}
        <h2 data-slot="legal-section-title">個人情報の取扱いに関するお問い合わせ</h2>
        <p className={cn(bodySmClass, "mt-4 max-w-160 text-muted-foreground")}>
          本ポリシーの内容についてのご質問は、下記までお寄せください。
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
