import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Switch } from "./switch";
import { Label } from "./label";

const meta = {
  title: "UI/Switch",
  component: Switch,
  tags: ["autodocs"],
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex items-center space-x-2">
      <Switch id="airplane-mode" />
      <Label htmlFor="airplane-mode">Airplane Mode</Label>
    </div>
  ),
};

export const Checked: Story = {
  args: {
    defaultChecked: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const SmallSize: Story = {
  render: () => (
    <div className="flex items-center space-x-2">
      <Switch size="sm" id="sm-switch" />
      <Label htmlFor="sm-switch">Small Switch</Label>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <div className="flex items-center space-x-2">
        <Switch size="sm" id="size-sm" defaultChecked />
        <Label htmlFor="size-sm">Small</Label>
      </div>
      <div className="flex items-center space-x-2">
        <Switch size="default" id="size-default" defaultChecked />
        <Label htmlFor="size-default">Default</Label>
      </div>
    </div>
  ),
};
