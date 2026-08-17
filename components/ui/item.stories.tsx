import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MoreHorizontal, Star } from "lucide-react";
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
} from "./item";
import { Avatar, AvatarFallback } from "./avatar";
import { Button } from "./button";

const meta = {
  title: "02 Elements/Item",
  component: Item,
  tags: ["autodocs"],
} satisfies Meta<typeof Item>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Item>
      <ItemContent>
        <ItemTitle>Item Title</ItemTitle>
        <ItemDescription>This is a description of the item.</ItemDescription>
      </ItemContent>
    </Item>
  ),
};

export const WithMedia: Story = {
  render: () => (
    <Item>
      <ItemMedia>
        <Avatar>
          <AvatarFallback>JD</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>John Doe</ItemTitle>
        <ItemDescription>Software Engineer</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="ghost" size="icon-sm" aria-label="More actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </ItemActions>
    </Item>
  ),
};

export const Group: Story = {
  render: () => (
    <ItemGroup className="w-full max-w-md">
      <ItemHeader>
        <ItemTitle>Team Members</ItemTitle>
      </ItemHeader>
      <Item>
        <ItemMedia>
          <Avatar>
            <AvatarFallback>A</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Alice</ItemTitle>
          <ItemDescription>Designer</ItemDescription>
        </ItemContent>
      </Item>
      <ItemSeparator />
      <Item>
        <ItemMedia>
          <Avatar>
            <AvatarFallback>B</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Bob</ItemTitle>
          <ItemDescription>Developer</ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  ),
};
