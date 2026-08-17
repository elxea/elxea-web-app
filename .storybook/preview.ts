import { createElement } from "react";
import type { Preview } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";

import messages from "../messages/ja.json";
import "../app/globals.css";

const preview: Preview = {
  /**
   * next-intl の locale context を全 story に供給する。`@/i18n/navigation` の
   * Link は locale を読むため、これが無いと Link を含む部品の story が
   * "No intl context found" で落ちる (2026-08-08 catalog パターンで顕在化)。
   */
  decorators: [
    (Story) =>
      createElement(
        NextIntlClientProvider,
        { locale: "ja", messages, timeZone: "Asia/Tokyo" },
        createElement(Story)
      ),
  ],
  parameters: {
    options: {
      /**
       * サイドバーの並びは **title の昇順** で決める。Storybook の既定は
       * 「story を読み込んだ順」なので、`01 Foundations` → `99 Preview` の
       * 抽象度順は title に付けた番号だけでは保証されない。
       *
       * 同じ title の中 (= 1 ファイル内の story どうし) は `0` を返して元の
       * 並びを保つ — story の順番は書いた順に意味がある (既定形 → 派生形、
       * 音源の説明順など) ので、名前順に崩さない。
       *
       * **型注釈を書かない**: Storybook はこの関数の *ソースを生成し直して*
       * `eval` するので (`storybook/dist/_node-chunks` の storySort 解析)、
       * TypeScript の注釈が残ると `SyntaxError: Unexpected token ':'` で
       * vitest の project 初期化ごと落ちる。引数の形は下の @param に書く。
       *
       * @param {{ title: string }} a
       * @param {{ title: string }} b
       */
      storySort: (a, b) =>
        a.title === b.title
          ? 0
          : a.title.localeCompare(b.title, "en", { numeric: true }),
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // "error" makes accessibility violations FAIL the Storybook vitest run
      // (was "todo" = report-only). CI runs `pnpm test --project storybook`.
      test: "error",
      // color-contrast axe rule is ACTIVE. It was temporarily disabled while the
      // muted-foreground token failed WCAG AA (#858581 on #fff = 3.7:1); the token
      // has since been darkened to oklch(0.460 0.006 106.6) (#585854) on both the
      // Figma variable and the code token simultaneously, meeting AA 4.5:1.
      // Resolved Issue: https://app.notion.com/p/39a70c9d064c818cbaceed6d628c4fd5
    },
  },
};

export default preview;
