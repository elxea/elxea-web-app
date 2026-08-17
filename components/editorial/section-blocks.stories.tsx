import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Ledger,
  OpenFaqList,
  PageSection,
  SectionBody,
  SectionHead,
  SectionNote,
  SpecBand,
  StepCards,
  TripleColumn,
} from "./section-blocks";

/**
 * R2 セクション骨格 — 商品詳細 (8056:1517 / 8057:1700) と
 * 定期便LP (8071:2 / 8073:2) が共有する行型のカタログ。
 */
const meta = {
  title: "03 Patterns/SectionBlocks",
  component: SectionHead,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SectionHead>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Section_Head: Story = {
  args: { overline: "TASTE MAP", title: "味と香りのマップ" },
  render: (args) => (
    <PageSection>
      <SectionHead {...args} />
      <SectionNote>
        位置は「淹れ方で動く範囲」の目安です。点数ではありません。
      </SectionNote>
    </PageSection>
  ),
};

export const Spec_Band: Story = {
  args: { overline: "SPEC" },
  render: () => (
    <PageSection>
      <SpecBand
        items={[
          { term: "品種", value: "ゆたかみどり" },
          { term: "産地", value: "鹿児島県南九州市 知覧" },
          { term: "摘採", value: "2025年4月中旬・一番茶" },
          { term: "仕上げ", value: "浅蒸し／中火の火入れ" },
        ]}
      />
    </PageSection>
  ),
};

export const Triple_Column: Story = {
  args: { overline: "TASTING", title: "味の記憶" },
  render: (args) => (
    <PageSection>
      <SectionHead {...args} />
      <SectionBody>
        <TripleColumn
          items={[
            { title: "香り", body: "青い草と、蒸した栗。湯気に鼻を近づけたときにいちばん濃く出ます。" },
            { title: "一煎目", body: "旨みが厚く、渋みはほとんど立ちません。" },
            { title: "二煎目以降", body: "渋みが輪郭をつくり、味が引き締まります。" },
          ]}
        />
      </SectionBody>
    </PageSection>
  ),
};

export const Ledger_TwoColumn: Story = {
  args: { overline: "SPECIFICATION" },
  render: (args) => (
    <PageSection>
      <SectionHead {...args} />
      <SectionBody>
        <Ledger
          rows={[
            { term: "茶種", value: "煎茶（浅蒸し）" },
            { term: "栽培", value: "露地／無被覆" },
            { term: "標高", value: "約 150m" },
            { term: "土壌", value: "火山灰質（シラス台地）" },
            { term: "火入れ", value: "中火・二段" },
            { term: "粉砕", value: "なし（荒仕上げ）" },
            { term: "保存", value: "密閉・冷暗所／開封後1か月" },
            { term: "賞味期限", value: "製造から12か月" },
          ]}
        />
      </SectionBody>
    </PageSection>
  ),
};

export const Open_Faq: Story = {
  args: { overline: "FAQ" },
  render: (args) => (
    <PageSection>
      <SectionHead {...args} />
      <SectionBody>
        <OpenFaqList
          items={[
            { q: "開封後はどのくらいもちますか", a: "密閉して冷暗所なら1か月が目安です。" },
            { q: "深蒸しとの違いは", a: "浅蒸しは葉の形が残り、水色が澄みます。" },
          ]}
        />
      </SectionBody>
    </PageSection>
  ),
};

export const Step_Cards: Story = {
  args: { overline: "HOW TO BREW", title: "淹れ方の目安" },
  render: (args) => (
    <PageSection>
      <SectionHead {...args} />
      <SectionBody>
        <StepCards
          items={[
            { step: "01", name: "茶葉 3g", body: "小さじ山盛り1杯ほど。急須に入れます。" },
            { step: "02", name: "湯 70℃ / 100ml", body: "一度うつわに移すとこのくらいです。" },
            { step: "03", name: "60秒", body: "急須をゆらさずに待ちます。" },
          ]}
        />
      </SectionBody>
    </PageSection>
  ),
};
