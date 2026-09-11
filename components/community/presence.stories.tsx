import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { NoteCard } from "./note-card";
import { ReactionChip } from "./reaction-chip";
import { ScaleBar } from "./scale-bar";

/**
 * みんなの気配 (匿名ノート) の部品群 (C1 Round 2)。
 * Figma 正本: AWLnI0XF07e8rScuxPYPc7 —
 * NoteCard 7840:39598 / ReactionChip 7840:39256 / ScaleBar 7840:39260。
 */
const meta = {
  title: "Community/Presence",
  component: NoteCard,
  parameters: { layout: "padded" },
} satisfies Meta<typeof NoteCard>;

export default meta;

type Story = StoryObj<typeof meta>;

const REACTIONS = [
  { id: "wakaru", label: "わかる", count: 12 },
  { id: "iina", label: "いいな", count: 5 },
  { id: "kininaru", label: "気になる", count: 3, pressed: true },
];

/** Figma 7840:39598 のプレビュー幅 560px に合わせた既定形。 */
export const Note: Story = {
  args: {
    voice: "朝いちばんに、湯を落とす音だけ聞いていた。",
    tea: "やぶきた / 一番茶",
    time: "6:40",
    reactions: REACTIONS,
    onSelectReaction: () => {},
    className: "max-w-[35rem]",
  },
};

/** リアクション無しの最小形 (投稿直後)。 */
export const NoteWithoutReactions: Story = {
  args: {
    voice: "水出しにしたら、渋みがどこかへ行った。",
    tea: "ほうじ茶",
    time: "21:05",
    className: "max-w-[35rem]",
  },
};

/** 選択状態はトグルボタンの `aria-pressed` で表す (色だけに依存しない)。 */
export const Chips: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <ReactionChip label="わかる" count={12} />
      <ReactionChip label="いいな" count={5} pressed />
      <ReactionChip label="気になる" />
    </div>
  ),
};

/** 相対量バー。読み上げ用に `label` が必須。 */
export const Scale: Story = {
  render: () => (
    <div className="flex max-w-[22.5rem] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">朝に飲まれた割合</span>
        <ScaleBar value={2 / 3} label="朝に飲まれた割合" />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">夜に飲まれた割合</span>
        <ScaleBar value={1 / 3} label="夜に飲まれた割合" />
      </div>
    </div>
  ),
};
