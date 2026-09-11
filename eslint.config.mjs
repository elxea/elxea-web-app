// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

import elxeaTokens from "./eslint-rules/index.mjs";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "dist/**",
      "storybook-static/**",
      "node_modules/**",
      ".phase-*",
      // 使い捨てスクリプト置き場 (gitignore 対象・.gitignore と対で維持する)
      "scripts/scratch/**",
      // vitest のカバレッジ出力 (`pnpm test:coverage`)。lcov-report/ に istanbul の
      // ベンダー JS (block-navigation.js / prettify.js / sorter.js) が入り、その
      // 先頭の eslint-disable が「Unused eslint-disable directive」warning になる。
      // `pnpm lint` は --max-warnings 0 なので、無視しないと一度カバレッジを計測
      // した作業ツリーで lint が必ず落ちる。.gitignore の `/coverage` と対で維持する。
      "coverage/**",
    ],
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

  // Border color enforcement: block `border` / `border-t` / `divide-y` etc.
  // that carry no border-color utility. Tailwind v4 sets only the width, so a
  // colorless border silently falls back to `currentColor` (= the body text
  // color, graphite #464748) instead of the `border` token. This is a visual
  // bug that reads as correct code, so it needs a machine check rather than
  // review discipline (it slipped past three consecutive fidelity lanes).
  // Stories are included on purpose: they are the DS reference renderings.
  // No suppressions file — the whole tree is clean as of the 罫線色総点検
  // task, and the intentional cases are written as `border-current`.
  {
    files: [
      "app/**/*.tsx",
      "app/**/*.jsx",
      "components/**/*.tsx",
      "components/**/*.jsx",
      "stories/**/*.tsx",
      "stories/**/*.jsx",
    ],
    plugins: {
      "elxea-tokens": elxeaTokens,
    },
    rules: {
      "elxea-tokens/no-colorless-border": "error",
    },
  },

  // roji 判断2 の機械強制（2026-08-08）:
  //   「新しいカルテの項目は必ず未連携カルテ（cx-agent の lineUsers）側に足す。3か所目を作らない」。
  //   未連携の人のカルテが 2 か所にある状態を今は畳まない代わりに、web-app 側のカルテ型を凍結して
  //   「web 側にだけ項目が足されて合流で落ちる」を lint で止める。error 級（pnpm lint は
  //   --max-warnings 0）。逃げ道は allowlist の更新のみで、差分に必ず現れる。
  //   根拠: https://www.notion.so/3b570c9d064c81d68610f9360f50c965 判断2
  {
    files: ["lib/firebase/types.ts"],
    plugins: {
      "elxea-tokens": elxeaTokens,
    },
    rules: {
      "elxea-tokens/no-new-karte-fields": "error",
    },
  },
];

export default eslintConfig;
