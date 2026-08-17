import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "./native-select";

const meta = {
  title: "02 Elements/NativeSelect",
  component: NativeSelect,
  tags: ["autodocs"],
} satisfies Meta<typeof NativeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <NativeSelect className="w-[180px]" aria-label="Select a fruit">
      <NativeSelectOption value="">Select a fruit</NativeSelectOption>
      <NativeSelectOption value="apple">Apple</NativeSelectOption>
      <NativeSelectOption value="banana">Banana</NativeSelectOption>
      <NativeSelectOption value="orange">Orange</NativeSelectOption>
    </NativeSelect>
  ),
};

export const WithOptGroup: Story = {
  render: () => (
    <NativeSelect className="w-[200px]" aria-label="Select an item">
      <NativeSelectOption value="">Select...</NativeSelectOption>
      <NativeSelectOptGroup label="Fruits">
        <NativeSelectOption value="apple">Apple</NativeSelectOption>
        <NativeSelectOption value="banana">Banana</NativeSelectOption>
      </NativeSelectOptGroup>
      <NativeSelectOptGroup label="Vegetables">
        <NativeSelectOption value="carrot">Carrot</NativeSelectOption>
        <NativeSelectOption value="broccoli">Broccoli</NativeSelectOption>
      </NativeSelectOptGroup>
    </NativeSelect>
  ),
};

export const Disabled: Story = {
  render: () => (
    <NativeSelect className="w-[180px]" disabled aria-label="Disabled select">
      <NativeSelectOption value="disabled">Disabled</NativeSelectOption>
    </NativeSelect>
  ),
};
