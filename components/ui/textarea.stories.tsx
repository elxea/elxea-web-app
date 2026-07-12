import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Textarea } from "./textarea";
import { Label } from "./label";

const meta = {
  title: "UI/Textarea",
  component: Textarea,
  tags: ["autodocs"],
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: "Type your message here.",
  },
};

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-full max-w-sm gap-1.5">
      <Label htmlFor="message">Your message</Label>
      <Textarea id="message" placeholder="Type your message here." />
    </div>
  ),
};

export const Disabled: Story = {
  args: {
    placeholder: "Disabled textarea",
    disabled: true,
  },
};

export const WithDefaultValue: Story = {
  args: {
    defaultValue: "This textarea has a default value that you can edit.",
    "aria-label": "Message",
  },
};
