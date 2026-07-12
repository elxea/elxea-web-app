import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Progress } from "./progress";

const meta = {
  title: "UI/Progress",
  component: Progress,
  tags: ["autodocs"],
  argTypes: {
    value: {
      control: { type: "range", min: 0, max: 100, step: 1 },
    },
  },
  // Progressbar needs an accessible name (axe aria-progressbar-name). Invisible.
  args: {
    "aria-label": "Loading progress",
  },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    value: 60,
  },
};

export const Empty: Story = {
  args: {
    value: 0,
  },
};

export const Full: Story = {
  args: {
    value: 100,
  },
};

export const AllValues: Story = {
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-4">
      <Progress value={0} aria-label="Progress 0%" />
      <Progress value={25} aria-label="Progress 25%" />
      <Progress value={50} aria-label="Progress 50%" />
      <Progress value={75} aria-label="Progress 75%" />
      <Progress value={100} aria-label="Progress 100%" />
    </div>
  ),
};
