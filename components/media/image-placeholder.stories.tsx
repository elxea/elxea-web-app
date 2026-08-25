import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { ImageCard } from "@/components/media/image-card";
import { ImagePlaceholder } from "@/components/media/image-placeholder";

/**
 * 画像が無いときに敷く面。
 *
 * story の役目は「器の大きさが変わっても中身が出ない」ことを目と assertion の
 * 両方で押さえること。以前はここに 80px 固定のロゴが入っており、小さい枠
 * (マイページのお気に入りは SP で 96x72) では横幅の 83% を占めて貼り付き、
 * 大きい枠では豆粒になっていた。面ごとの見え方の差はこの story で気づける。
 */
const meta = {
  title: "Media/ImagePlaceholder",
  component: ImagePlaceholder,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ImagePlaceholder>;

export default meta;
type Story = StoryObj<typeof meta>;

/** マイページのお気に入りサムネと同寸 (SP 96x72)。かつて一番崩れていた器。 */
export const Thumbnail: Story = {
  render: () => (
    <div className="relative h-18 w-24 overflow-hidden">
      <ImagePlaceholder />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector('[data-slot="image-placeholder"]');
    await expect(el).not.toBeNull();
    // 中に子要素 (ロゴ等) を持たない面であることを固定する。
    await expect(el?.childElementCount).toBe(0);
    await expect(el?.getAttribute("aria-hidden")).toBe("true");
  },
};

/** 記事カードと同寸。小さい器と同じ見え方になることを確かめる。 */
export const Card: Story = {
  render: () => (
    <div className="max-w-sm">
      <ImageCard alt="" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const el = canvasElement.querySelector('[data-slot="image-placeholder"]');
    await expect(el).not.toBeNull();
    await expect(el?.childElementCount).toBe(0);
  },
};

/** 大小を並べる。器の大きさが 10 倍ちがっても同じ面に見えるのが正。 */
export const SideBySide: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      <div className="relative h-18 w-24 overflow-hidden">
        <ImagePlaceholder />
      </div>
      <div className="relative h-30 w-40 overflow-hidden">
        <ImagePlaceholder />
      </div>
      <div className="w-64">
        <ImageCard alt="" />
      </div>
    </div>
  ),
};
