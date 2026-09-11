import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./collapsible";
import { Button } from "./button";

const meta = {
  title: "UI/Collapsible",
  component: Collapsible,
  tags: ["autodocs"],
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    const [isOpen, setIsOpen] = React.useState(false);
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-[350px] space-y-2">
        <div className="flex items-center justify-between space-x-4 px-4">
          <h4 className="text-sm font-semibold">3 items</h4>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              <ChevronsUpDown className="size-4" />
              <span className="sr-only">Toggle</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        <div className="rounded-md border border-border px-4 py-2 font-mono text-sm shadow-sm">
          Item 1
        </div>
        <CollapsibleContent className="space-y-2">
          <div className="rounded-md border border-border px-4 py-2 font-mono text-sm shadow-sm">
            Item 2
          </div>
          <div className="rounded-md border border-border px-4 py-2 font-mono text-sm shadow-sm">
            Item 3
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  },
};
