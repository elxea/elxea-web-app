import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";
import { Calendar } from "./calendar";

/**
 * story の「今日」を固定する。
 *
 * Calendar は `today` modifier に `bg-accent` を当て (calendar.tsx の
 * `classNames.today`)、選択が無いときは現在月を初期表示する
 * (react-day-picker v9 の既定)。素の `new Date()` のままだと
 * (1) today のハイライト位置が毎日ずれ (2) 月替わりでグリッド全体が変わるため、
 * 実装が 1 行も変わっていない日でも Chromatic のスナップショットが差分になる。
 * 毎日赤くなる警報は「狼少年」化して本物の視覚差分を埋もれさせるので、
 * 基準日を固定して誤報そのものを断つ。
 *
 * 固定するのは `today` / `defaultMonth` / `selected` の 3 つ。
 * `selected` だけでは today のハイライトが動き続け、`today` だけでは
 * 選択なし story (Range) の表示月が動き続けるため、どれも省略できない。
 *
 * 日付は数値コンストラクタで作る。`new Date("2026-01-15")` は UTC 解釈され、
 * ローカル (JST) と CI ランナー (UTC) で表示日がずれうるため使わない。
 */
const FIXED_TODAY = new Date(2026, 0, 15); // 2026-01-15 (木)

const meta = {
  title: "UI/Calendar",
  component: Calendar,
  tags: ["autodocs"],
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    const [date, setDate] = React.useState<Date | undefined>(FIXED_TODAY);
    return (
      <Calendar
        mode="single"
        today={FIXED_TODAY}
        defaultMonth={FIXED_TODAY}
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
        today={FIXED_TODAY}
        defaultMonth={FIXED_TODAY}
        selected={range}
        onSelect={(r) => setRange(r ?? { from: undefined, to: undefined })}
        numberOfMonths={2}
        className="rounded-md border border-border"
      />
    );
  },
};
