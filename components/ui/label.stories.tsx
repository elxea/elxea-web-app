import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Label } from "./label";
import { Input } from "./input";

const meta = {
  title: "UI/Label",
  component: Label,
  tags: ["autodocs"],
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Label Text",
  },
};

export const WithInput: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-1.5">
      <Label htmlFor="name">Full Name</Label>
      <Input id="name" placeholder="Enter your name" />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="group grid w-full max-w-sm gap-1.5" data-disabled="true">
      <Label htmlFor="disabled">Disabled Label</Label>
      <Input id="disabled" disabled placeholder="Disabled" />
    </div>
  ),
};
