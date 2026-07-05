import type { Preview } from "@storybook/nextjs-vite";
import "../app/globals.css";

const preview: Preview = {
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
    },
  },
};

export default preview;
