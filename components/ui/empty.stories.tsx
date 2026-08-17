import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Inbox } from "lucide-react";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from "./empty";
import { Button } from "./button";

const meta = {
  title: "02 Elements/Empty",
  component: Empty,
  tags: ["autodocs"],
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>No items found</EmptyTitle>
        <EmptyDescription>
          There are no items to display at this time.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>
          Get started by creating your first project.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Create Project</Button>
      </EmptyContent>
    </Empty>
  ),
};
