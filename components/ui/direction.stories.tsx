import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DirectionProvider } from "./direction";

const meta = {
  title: "02 Elements/DirectionProvider",
  component: DirectionProvider,
  tags: ["autodocs"],
} satisfies Meta<typeof DirectionProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LTR: Story = {
  render: () => (
    <DirectionProvider direction="ltr">
      <div className="rounded-md border border-border p-4">
        <p className="text-sm">This content is rendered in LTR direction.</p>
      </div>
    </DirectionProvider>
  ),
};

export const RTL: Story = {
  render: () => (
    <DirectionProvider direction="rtl">
      <div className="rounded-md border border-border p-4" dir="rtl">
        <p className="text-sm">This content is rendered in RTL direction.</p>
      </div>
    </DirectionProvider>
  ),
};
