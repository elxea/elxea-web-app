import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";

import { ServiceOverview } from "./service-overview";

/**
 * Figma 正本: AWLnI0XF07e8rScuxPYPc7 —
 * Service Overview (Module) PC 7970:42142 / SP 7970:42206。
 * コピーは Figma の実文言をそのまま入れて、行数と折返し位置まで対比できるようにする。
 *
 * `@/i18n/navigation` の Link は `useLocale()` を要求するので、
 * Storybook では NextIntlClientProvider で包む。
 */
const meta = {
  title: "03 Patterns/ServiceOverview",
  component: ServiceOverview,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <NextIntlClientProvider locale="ja" messages={{}}>
        <Story />
      </NextIntlClientProvider>
    ),
  ],
} satisfies Meta<typeof ServiceOverview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    kicker: "ELXEA — OVERVIEW",
    title: "elxea でできること",
    lead: "お茶を買う。読む。体験する。elxea は、日々の中に「お茶の時間」をつくる、ひとつづきのサービスです。",
    tiles: [
      {
        kicker: "TEA",
        title: "お茶",
        body: "シングルオリジン煎茶からほうじ茶・和紅茶・道具まで。茶葉と道具のオンラインストア。",
        href: "/products",
        linkLabel: "茶葉の一覧へ",
      },
      {
        kicker: "JOURNAL",
        title: "ジャーナル",
        body: "淹れ方と産地の読みもの。「茶葉の保存は、難しく考えない」「水出しという選択肢」など。",
        href: "/journal",
        linkLabel: "ジャーナルを読む",
      },
      {
        kicker: "EVENT",
        title: "イベント",
        body: "淹れ方をたしかめる少人数の会。オンラインと対面で開催しています。",
        href: "/events",
        linkLabel: "イベントを見る",
      },
      {
        kicker: "ROJI",
        title: "roji",
        body: "お茶・読みもの・体験をひとつづきに楽しむ、elxea の統合サービス。",
        href: "/journal",
        linkLabel: "roji について",
      },
    ],
    about: {
      title: "elxea について",
      description: "ブランドの考え方と、店の運営について。",
      href: "/about",
      linkLabel: "アバウトページへ",
    },
  },
};

/** SP 375 (Figma 7970:42206) — 4 タイルが 1 列に積み上がる。 */
export const Mobile: Story = {
  args: Default.args,
  parameters: { viewport: { defaultViewport: "mobile1" } },
};
