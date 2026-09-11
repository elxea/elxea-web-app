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
