// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

import elxeaTokens from "./eslint-rules/index.mjs";

const eslintConfig = [
  {
    ignores: [".next/**", "dist/**", "storybook-static/**", "node_modules/**", ".phase-*"],
  },
  ...nextCoreWebVitals,
  ...storybook.configs["flat/recommended"],

  // Server Components use try/catch for data-fetch error handling, which is
  // the correct pattern (error boundaries only apply to client components).
  {
    files: ["app/**/*.tsx", "app/**/*.ts"],
    rules: {
      "react-hooks/error-boundaries": "off",
    },
  },

  // Browser-only state initialization (cookies, localStorage) requires
  // setState inside useEffect to avoid SSR hydration mismatches.
  // shadcn/ui sidebar uses Math.random in useMemo for skeleton widths.
  {
    files: ["components/**/*.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },

  // Design token enforcement: block raw color values AND arbitrary length
  // values (px/rem/em) in favor of design tokens. Error-level so NEW
  // violations fail the build (`pnpm lint` runs with --max-warnings 0).
  // Scope widened to app/** and components/ui/** (previously components/**
  // minus ui, warn-only, which caught nothing).
  // Pre-existing violations are grandfathered via eslint-suppressions.json
  // (generated with `pnpm exec eslint --suppress-all`), which records the
  // exact file+count so the debt stays visible and new code cannot regress.
  {
    files: [
      "app/**/*.tsx",
      "app/**/*.jsx",
      "components/**/*.tsx",
      "components/**/*.jsx",
    ],
    ignores: [
      "**/*.stories.tsx",
      "**/*.stories.jsx",
    ],
    plugins: {
      "elxea-tokens": elxeaTokens,
    },
    rules: {
      "elxea-tokens/no-raw-colors": ["error", { checkArbitraryValues: true }],

      // design-system-audit C3 (CRITICAL): section max-width/padding must come
      // from the shared `.section-*` utility, and the vertical spacing between
      // stacked blocks must be owned by the arranging container rather than
      // delegated to each child.
      //
      // Why error-level rather than an audit note: C3 previously lived only as
      // prose in the `design-system-audit` skill, which qa-pipeline runs as
      // Gate 3 — a SOFT gate that records a warning and continues. It therefore
      // could not stop anything, and the /ja/playlists 0px-gap defect shipped
      // even though C3 describes it exactly. Promoting the CRITICAL half of C3
      // to a blocking check means CI (`static-checks` -> `pnpm lint`, which runs
      // with --max-warnings 0) fails instead of merely warning.
      //
      // Pre-existing violations are grandfathered in eslint-suppressions.json,
      // so only NEW code fails while the debt stays counted and visible.
      // Per-site escape hatch: a `DS-exception: <reason>` comment.
      // Kill switch: change this line to "off".
      "elxea-tokens/section-spacing-utility": "error",
    },
  },
];

export default eslintConfig;
