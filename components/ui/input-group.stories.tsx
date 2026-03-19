import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Search, Mail } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
} from "./input-group";
import { Button } from "./button";

const meta = {
  title: "UI/InputGroup",
  component: InputGroup,
  tags: ["autodocs"],
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <InputGroup className="w-[300px]">
      <InputGroupInput placeholder="Search..." />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" variant="ghost">
          <Search className="size-4" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithPrefix: Story = {
  render: () => (
    <InputGroup className="w-[300px]">
      <InputGroupAddon align="inline-start">
        <InputGroupText>
          <Mail className="size-4" />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="you@example.com" />
    </InputGroup>
  ),
};

export const WithButton: Story = {
  render: () => (
    <InputGroup className="w-[300px]">
      <InputGroupInput placeholder="Enter URL" />
      <InputGroupAddon align="inline-end">
        <Button size="sm">Go</Button>
      </InputGroupAddon>
    </InputGroup>
  ),
};
