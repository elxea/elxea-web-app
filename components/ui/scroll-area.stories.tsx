import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ScrollArea, ScrollBar } from "./scroll-area";
import { Separator } from "./separator";

const meta = {
  title: "02 Elements/ScrollArea",
  component: ScrollArea,
  tags: ["autodocs"],
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

const tags = Array.from({ length: 50 }).map(
  (_, i, a) => `v1.${a.length - i}.0`
);

export const Default: Story = {
  render: () => (
    <ScrollArea className="h-72 w-48 rounded-md border border-border">
      <div className="p-4">
        <h4 className="mb-4 text-sm font-medium leading-none">Tags</h4>
        {tags.map((tag) => (
          <div key={tag}>
            <div className="text-sm">{tag}</div>
            <Separator className="my-2" />
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <ScrollArea className="w-96 whitespace-nowrap rounded-md border border-border">
      <div className="flex w-max space-x-4 p-4">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="flex h-20 w-32 shrink-0 items-center justify-center rounded-md bg-muted"
          >
            Item {i + 1}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
};
