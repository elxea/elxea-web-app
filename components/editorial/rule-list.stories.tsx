import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  CategoryIndex,
  ChapterBreak,
  DisclosureRow,
  LinkRow,
  MetaRow,
  Overline,
} from "./rule-list";

/**
 * Editorial / RuleList — Figma `Common / Layouts` FAQ 確定レイアウト (7848:450) の行部品。
 * 罫線 1 本で区切る読み物系レイアウトの共通部品。
 */
const meta = {
  title: "Editorial/RuleList",
  component: DisclosureRow,
  parameters: { layout: "padded" },
} satisfies Meta<typeof DisclosureRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Figma 7848:39435 — 本文を持たない行。開閉マークを出さない。 */
export const DisclosureClosed: Story = {
  args: {
    question: "シングルオリジンとは何ですか",
    summary: "単一農園・単一品種・単一収穫時期で仕上げたお茶のことです。",
  },
};

/** Figma 7848:39430 — 本文を持ち、既定で開いている行。 */
export const DisclosureOpen: Story = {
  args: {
    question: "おいしい淹れ方を教えてください",
    summary: "決めていません。目安だけ、パッケージの裏に書いています。",
    defaultOpen: true,
    children:
      "湯の温度も、蒸らす時間も、正解は置いていません。パッケージの裏には「70℃・90秒」といった目安だけを記しています。",
  },
};

/** グループ見出し + 複数行。Figma 7848:39427 のグループ 01 相当。 */
export const DisclosureGroup: Story = {
  args: { question: "", summary: "" },
  render: () => (
    <section>
      <Overline>01 / ABOUT TEA</Overline>
      <h3 className="mt-3">お茶のこと</h3>
      <div className="mt-5">
        <DisclosureRow
          question="おいしい淹れ方を教えてください"
          summary="決めていません。目安だけ、パッケージの裏に書いています。"
          defaultOpen
        >
          湯の温度も、蒸らす時間も、正解は置いていません。
        </DisclosureRow>
        <DisclosureRow
          question="シングルオリジンとは何ですか"
          summary="単一農園・単一品種・単一収穫時期で仕上げたお茶のことです。"
        />
        <DisclosureRow
          question="賞味期限と保存方法を教えてください"
          summary="未開封で製造から1年、開封後は1か月が目安です。"
        />
      </div>
    </section>
  ),
};

/** Figma 7848:39293 — label / value の 2 列メタ行。 */
export const Meta_Rows: Story = {
  args: { question: "", summary: "" },
  render: () => (
    <dl>
      <MetaRow label="答え">開かなくても、要点は1行で読めます</MetaRow>
      <MetaRow label="見つからない">ページ下部のお問い合わせへ</MetaRow>
      <MetaRow label="更新">2026年8月5日</MetaRow>
    </dl>
  ),
};

/** Figma 7848:530 — 罫線だけのカテゴリ目次。PC 4 列 / SP 縦 1 列。 */
export const Category_Index: Story = {
  args: { question: "", summary: "" },
  render: () => (
    <CategoryIndex
      aria-label="カテゴリ"
      items={[
        { label: "01  お茶のこと", href: "#faq-01" },
        { label: "02  ご注文とお届け", href: "#faq-02" },
        { label: "03  定期便", href: "#faq-03" },
        { label: "04  会員とその他", href: "#faq-04" },
      ]}
    />
  ),
};

/** Figma 7848:532 — 明度反転の章切り。 */
export const Chapter_Break: Story = {
  args: { question: "", summary: "" },
  render: () => (
    <ChapterBreak overline="NO RIGHT ANSWER" title="淹れ方の正解は、置いていません。">
      ここに書いているのは、あくまで目安です。あとは、あなたの好きなように。
    </ChapterBreak>
  ),
};

/** Figma 7849:39321 — title / desc / → の遷移行。 */
export const Link_Rows: Story = {
  args: { question: "", summary: "" },
  render: () => (
    <div>
      <LinkRow href="/contact" title="お問い合わせ">
        フォームからご連絡ください。3営業日以内にお返事します。
      </LinkRow>
      <LinkRow href="/journal" title="お茶のこと、もう少し">
        淹れ方・産地・品種の読み物をまとめています。
      </LinkRow>
    </div>
  ),
};
