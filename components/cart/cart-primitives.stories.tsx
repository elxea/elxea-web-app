import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";

import { CartLine } from "./cart-line";
import { OrderSummary } from "./order-summary";
import { QuantityStepper } from "@/components/ui/quantity-stepper";

/**
 * カート部品 (C5-1)。
 * Figma 正本: AWLnI0XF07e8rScuxPYPc7 —【R2: 確定版】カート 変A（部品ベース）
 * section 6679:14041 / PC CartLine 6684:124 / SP CartItemSP 6686:14186 /
 * OrderSummary 6684:163 / Stepper 6906:335。
 *
 * 数値・文言は Figma フレームの見本値をそのまま使う (実データではない)。
 */
const meta = {
  title: "Cart/Primitives",
  component: CartLine,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CartLine>;

export default meta;

type Story = StoryObj<typeof meta>;

const LINE_BASE = {
  title: "煎茶 茜 -akane-",
  variantLabel: "内容量: 100g",
  unitPrice: "¥1,800",
  linePrice: "¥3,600",
  quantity: 2,
  quantityLabel: "数量",
  removeLabel: "削除",
  onQuantityChange: () => {},
  onRemove: () => {},
};

/** 定期便 (sellingPlan) 付きの行。3 行目に「定期便: ...」が入る。 */
export const LineWithSubscription: Story = {
  args: { ...LINE_BASE, planLabel: "定期便: 毎月1回お届け" },
  render: (args) => (
    <ul className="divide-border divide-y">
      <CartLine {...args} />
    </ul>
  ),
};

/** 通常購入の行 (定期便ラベルなし)。 */
export const LineOneTime: Story = {
  args: {
    ...LINE_BASE,
    title: "玉露 翠 -midori-",
    variantLabel: "内容量: 50g",
    unitPrice: "¥2,400",
    linePrice: "¥2,400",
    quantity: 1,
  },
  render: (args) => (
    <ul className="divide-border divide-y">
      <CartLine {...args} />
    </ul>
  ),
};

/** 明細 2 行 = Figma PC/SP フレームと同じ並び (罫線 1 本で区切る)。 */
export const Lines: Story = {
  args: LINE_BASE,
  render: () => (
    <ul className="divide-border divide-y">
      <CartLine {...LINE_BASE} planLabel="定期便: 毎月1回お届け" />
      <CartLine
        {...LINE_BASE}
        title="玉露 翠 -midori-"
        variantLabel="内容量: 50g"
        unitPrice="¥2,400"
        linePrice="¥2,400"
        quantity={1}
      />
    </ul>
  ),
};

/** 数量ステッパ単体。min=1 なので 1 のとき minus は disabled。 */
export const Stepper: Story = {
  args: LINE_BASE,
  render: () => {
    const [value, setValue] = React.useState(2);
    return (
      <div className="flex flex-col gap-4">
        <QuantityStepper value={value} onChange={setValue} label="数量" />
        <QuantityStepper value={1} onChange={() => {}} label="数量" />
        <QuantityStepper value={3} onChange={() => {}} label="数量" disabled />
      </div>
    );
  },
};

/** 注文サマリー枠。PC は 360px 固定、SP は全幅。 */
export const Summary: Story = {
  args: LINE_BASE,
  render: () => (
    <OrderSummary
      heading="注文サマリー"
      subtotalLabel="小計"
      subtotal="¥6,000"
      totalLabel="合計"
      total="¥6,000"
      checkoutLabel="購入手続きへ"
      checkoutUrl="#"
    />
  ),
};
