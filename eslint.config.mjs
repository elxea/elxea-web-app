// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

import elxeaTokens from "./eslint-rules/index.mjs";

const eslintConfig = [
  {
    ignores: [".next/**", "dist/**", "storybook-static/**", "node_modules/**"],
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

  // Design token enforcement: detect raw color values in components
  {
    files: ["components/**/*.tsx", "components/**/*.jsx"],
    ignores: [
      "components/ui/**",
      "**/*.stories.tsx",
      "**/*.stories.jsx",
    ],
    plugins: {
      "elxea-tokens": elxeaTokens,
    },
    rules: {
      "elxea-tokens/no-raw-colors": "warn",
    },
  },
];

export default eslintConfig;
