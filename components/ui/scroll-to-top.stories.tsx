import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ScrollToTop } from "./scroll-to-top";
import { Button } from "./button";
import { ChevronUp } from "lucide-react";

const meta = {
  title: "UI/ScrollToTop",
  component: ScrollToTop,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A floating button that appears when the user scrolls down. In Storybook, the scroll threshold (400px) may not be triggered. Use the Visual Preview story to see the button style.",
      },
    },
  },
} satisfies Meta<typeof ScrollToTop>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="h-[800px] relative">
      <p className="text-sm text-muted-foreground mb-4">
        Scroll down in the story canvas to see the button appear.
      </p>
      <ScrollToTop />
    </div>
  ),
};

export const VisualPreview: Story = {
  render: () => (
    <div className="relative p-8">
      <p className="text-sm text-muted-foreground mb-4">
        Static preview of the scroll-to-top button style:
      </p>
      <Button
        variant="outline"
        size="icon"
        className="opacity-70 hover:opacity-100 transition-opacity shadow-md"
        aria-label="Scroll to top"
      >
        <ChevronUp className="size-4" />
      </Button>
    </div>
  ),
};
