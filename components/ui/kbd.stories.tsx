import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Kbd, KbdGroup } from "./kbd";

const meta = {
  title: "02 Elements/Kbd",
  component: Kbd,
  tags: ["autodocs"],
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <Kbd>Ctrl</Kbd>,
};

export const Group: Story = {
  render: () => (
    <KbdGroup>
      <Kbd>Ctrl</Kbd>
      <Kbd>C</Kbd>
    </KbdGroup>
  ),
};

export const MultipleShortcuts: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <Kbd>S</Kbd>
      </KbdGroup>
      <span className="text-sm text-muted-foreground">Save</span>
    </div>
  ),
};
