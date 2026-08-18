import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ChatPanel } from "./chat-panel";

/**
 * Figma 正本: AWLnI0XF07e8rScuxPYPc7 — `Chat / Panel (開いた状態・デスクトップ)` 6859:316。
 * 本文 (メッセージ一覧) は呼び出し側が差すので、story ではバブル相当の板を置いて
 * ヘッダーと本文の関係だけを見る。
 */
const meta = {
  title: "Chat/Panel",
  component: ChatPanel,
  parameters: { layout: "padded" },
  args: { title: "elxea assistant", onClose: () => {} },
} satisfies Meta<typeof ChatPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Figma 6859:322 の本文 (バブル左右 16 / バブル間 12) を再現した既定形。 */
export const Default: Story = {
  args: {
    children: (
      <div className="flex flex-col gap-3 p-4">
        <div className="max-w-[80%] self-start rounded-2xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
          こんにちは。お茶のことなら何でも聞いてください。今日はどんな気分ですか。
        </div>
        <div className="max-w-[80%] self-end rounded-2xl bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background">
          さっぱりしたものが飲みたい
        </div>
      </div>
    ),
  },
};

/** 本文が 1 件だけの最小形。ヘッダー高 32px は本文量に依存しない。 */
export const SingleMessage: Story = {
  args: {
    children: (
      <div className="flex flex-col gap-3 p-4">
        <div className="max-w-[80%] self-start rounded-2xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
          水出しなら、ゆっくり出すほど渋みが出ません。
        </div>
      </div>
    ),
  },
};
