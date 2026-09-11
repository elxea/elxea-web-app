import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { BGM_URL } from "@/lib/audio/bgm-source";
import { PEAKS_BUCKETS } from "@/lib/audio/peaks";

import { AudioWaveform } from "./audio-waveform";

/**
 * AudioWaveform — 波形シーク帯。
 *
 * 掴んで擦る操作そのものが部品の主題なので、story は
 * **再生位置を state で持つ**。擦れば `progress` が動き、指を離した位置で
 * 確定する (`onScrub` → プレビュー / `onSeek` → 確定)。
 *
 * 波形データの経路は 3 つあり、story もそれぞれに 1 本ずつ置いてある:
 *
 * 1. `peaks` を直接渡す → フェッチしない
 * 2. `src` に対応する `public/audio/peaks/<key>.json` がある → それを使う
 * 3. どちらも無い → src から決定的に合成する (再描画しても形が変わらない)
 */
const meta = {
  title: "Audio/AudioWaveform",
  component: AudioWaveform,
  parameters: { layout: "padded" },
} satisfies Meta<typeof AudioWaveform>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 擦れる状態を story 側で成立させるための入れ物。 */
function ScrubbableWaveform({
  src,
  peaks,
  disabled,
  initialProgress = 0.32,
  className,
}: {
  src: string | null;
  peaks?: number[];
  disabled?: boolean;
  initialProgress?: number;
  className?: string;
}) {
  const [progress, setProgress] = React.useState(initialProgress);

  return (
    <AudioWaveform
      src={src}
      peaks={peaks}
      progress={progress}
      disabled={disabled}
      onScrub={setProgress}
      onSeek={setProgress}
      ariaLabel="再生位置"
      className={className}
    />
  );
}

/** 事前計算した波形 (`public/audio/peaks/` に実在するもの)。 */
export const Precomputed: Story = {
  args: { src: BGM_URL, progress: 0.32, onSeek: () => {}, ariaLabel: "再生位置" },
  render: () => <ScrubbableWaveform src={BGM_URL} />,
};

/** 波形 JSON が無い src。合成波形に落ちる (形は src が同じなら常に同じ)。 */
export const Synthesized: Story = {
  args: { src: null, progress: 0, onSeek: () => {}, ariaLabel: "再生位置" },
  render: () => (
    <ScrubbableWaveform src="https://example.invalid/no-peaks.mp3" />
  ),
};

/** CMS が波形を直接持っている場合。フェッチは起きない。 */
export const InlinePeaks: Story = {
  args: { src: null, progress: 0, onSeek: () => {}, ariaLabel: "再生位置" },
  render: () => (
    <ScrubbableWaveform
      src={null}
      peaks={Array.from({ length: PEAKS_BUCKETS }, (_, i) =>
        Math.abs(Math.sin(i / 5) * 0.55 + Math.sin(i / 31) * 0.4)
      )}
    />
  ),
};

/** 読み込み中・エラー時。掴めないことが見てわかる状態。 */
export const Disabled: Story = {
  args: { src: null, progress: 0, onSeek: () => {}, ariaLabel: "再生位置" },
  render: () => <ScrubbableWaveform src={BGM_URL} disabled initialProgress={0} />,
};

/** 高さを変えても本数は変わらない (`className` は帯の高さだけを決める)。 */
export const Heights: Story = {
  args: { src: null, progress: 0, onSeek: () => {}, ariaLabel: "再生位置" },
  render: () => (
    <div className="flex flex-col gap-8">
      {["h-8", "h-12", "h-20"].map((h) => (
        <ScrubbableWaveform key={h} src={BGM_URL} className={h} />
      ))}
    </div>
  ),
};
