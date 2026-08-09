import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";
import { Calendar } from "./calendar";

const meta = {
  title: "UI/Calendar",
  component: Calendar,
  tags: ["autodocs"],
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    const [date, setDate] = React.useState<Date | undefined>(new Date());
    return (
      <Calendar
        mode="single"
        selected={date}
        onSelect={setDate}
        className="rounded-md border border-border"
      />
    );
  },
};

export const Range: Story = {
  render: function Render() {
    const [range, setRange] = React.useState<{
      from: Date | undefined;
      to: Date | undefined;
    }>({ from: undefined, to: undefined });
    return (
      <Calendar
        mode="range"
        selected={range}
        onSelect={(r) => setRange(r ?? { from: undefined, to: undefined })}
        numberOfMonths={2}
        className="rounded-md border border-border"
      />
    );
  },
};
