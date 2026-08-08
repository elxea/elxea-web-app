import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
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

/**
 * 数量変更・削除の配線テスト。
 * `+` / `-` が現在数量 ±1 で `onQuantityChange` を呼ぶこと、`削除` が `onRemove` を
 * 呼ぶこと、`-` が下限 (1) で無効化されることを実クリックで確認する。
 * 実カートの Server Action は cart-context 側の責務なので、ここでは行部品の
 * コールバック配線だけを検証する。
 */
export const LineInteractions: Story = {
  args: {
    ...LINE_BASE,
    planLabel: "定期便: 毎月1回お届け",
    onQuantityChange: fn(),
    onRemove: fn(),
  },
  render: (args) => (
    <ul className="divide-border divide-y">
      <CartLine {...args} />
    </ul>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "数量 +1" }));
    await expect(args.onQuantityChange).toHaveBeenLastCalledWith(3);

    await userEvent.click(canvas.getByRole("button", { name: "数量 -1" }));
    await expect(args.onQuantityChange).toHaveBeenLastCalledWith(1);

    await userEvent.click(canvas.getByRole("button", { name: "削除" }));
    await expect(args.onRemove).toHaveBeenCalled();
  },
};

/** 数量 1 のとき `-` は無効 (0 にして暗黙削除しない。削除は「削除」ボタン経由)。 */
export const LineMinQuantity: Story = {
  args: { ...LINE_BASE, quantity: 1, onQuantityChange: fn() },
  render: (args) => (
    <ul className="divide-border divide-y">
      <CartLine {...args} />
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "数量 -1" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "数量 +1" })).toBeEnabled();
  },
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

/**
 * 注文サマリー枠。PC は 360px 固定、SP は全幅。
 * 「購入手続きへ」は Shopify の `checkoutUrl` へ出る素の `<a href>` (外部遷移なので
 * next-intl の Link ではない)。href が渡した URL になっていることを検証する。
 */
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
      checkoutUrl="https://example.myshopify.com/checkout/abc"
      onCheckout={fn()}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cta = canvas.getByRole("link", { name: "購入手続きへ" });
    await expect(cta).toHaveAttribute(
      "href",
      "https://example.myshopify.com/checkout/abc",
    );
  },
};
