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
      // KNOWN ISSUE (temporary, rule-scoped): the color-contrast axe rule is
      // disabled pending a design-token fix. Root cause is a single token:
      // muted-foreground (#858581) on #fff = 3.7:1, below WCAG AA 4.5:1.
      // Fixing requires a VISUAL change (darken the token) done on BOTH the
      // Figma variable and the code token simultaneously to avoid drift, so it
      // is out of scope for a code-only gate fix and tracked separately.
      // ONLY color-contrast is disabled; every other axe rule stays active.
      // Remove this block (re-enabling color-contrast globally) once the token
      // meets AA and close the tracking Issue.
      // Tracking Issue: https://app.notion.com/p/39a70c9d064c818cbaceed6d628c4fd5
      config: {
        rules: [{ id: "color-contrast", enabled: false }],
      },
    },
  },
};

export default preview;
