import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AspectRatio } from "./aspect-ratio";

const meta = {
  title: "02 Elements/AspectRatio",
  component: AspectRatio,
  tags: ["autodocs"],
} satisfies Meta<typeof AspectRatio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="w-[450px]">
      <AspectRatio ratio={16 / 9}>
        <div className="flex h-full w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
          16:9
        </div>
      </AspectRatio>
    </div>
  ),
};

export const Square: Story = {
  render: () => (
    <div className="w-[300px]">
      <AspectRatio ratio={1}>
        <div className="flex h-full w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
          1:1
        </div>
      </AspectRatio>
    </div>
  ),
};
