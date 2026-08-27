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
      // `vercel build` / `vercel dev` がローカルに作る出力。中身は `.next` を
      // まるごと写した本番バンドル (minify 済みの巨大な JS を含む) なので、
      // lint 対象に入ると ESLint がそれを 1 ファイルずつ parse しようとして
      // ヒープを食い潰し、`pnpm lint` が JS heap out of memory で落ちる。
      // `.next/**` を無視しているのと同じ理由 — 生成物であって原稿ではない。
      // `.gitignore` の `.vercel` と対で維持する。
      ".vercel/**",
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

  // 「押した瞬間に効く」の機械強制（2026-08-26 / Setaka 実機指摘）:
  //   画面からサーバへ書き込むときは lib/interaction の共通 hook を通す。
  //   直に Server Action / fetch を呼ぶと、押した瞬間の反応・失敗時の巻き戻し・
  //   言い直し・連打の整理がどれも付いてこない。実際それが「押しても 2 秒動かない」
  //   の発生源だった（カート数量の +/- は本番実測 1,905〜2,062ms のあいだ受付を
  //   閉じていて、250ms 間隔の 2 回目が黙って捨てられていた）。
  //   error 級（pnpm lint は --max-warnings 0）。逃げ道はルール内の allowlist のみで、
  //   **縮小方向にのみ更新する**。分類の正本は lib/interaction/mutation-classes.ts。
  {
    files: ["components/**/*.tsx", "app/**/*.tsx"],
    plugins: {
      "elxea-tokens": elxeaTokens,
    },
    rules: {
      "elxea-tokens/mutation-through-shared-primitive": "error",
    },
  },

  // 憲章 R4「設定値は起動時検証・raw 読み禁止」の機械強制（2026-08-27）:
  //   アプリの実行コードは `process.env` に触らない。設定は `lib/config/spec.ts`
  //   に宣言し、`env("NAME")` で読む。
  //
  // なぜ規律ではなく lint なのか: 同じ処方を一度やって失敗しているから。
  // `lib/env.ts` は 2026-08 の sitemap 事故のあとに「生読みをやめる」ために作られ、
  // 中身も正しかったが、移行したのは 3 か所だけで、残りは生読みのままだった。
  // そこに LINE の Channel Secret 末尾改行が落ちて 2026-08-22 に本番の連携が
  // 落ちている（経緯は `lib/config/spec.ts` 冒頭）。装置を足すだけでは再流入が
  // 止まらない、というのが憲章 R8 の指す失敗型そのもの。
  //
  // 自作 AST ルールではなく標準の `no-restricted-syntax` で書いている。
  // `process.env` は member expression 1 つで、セレクタ 1 本で過不足なく当たる
  // ため、eslint-rules/ に 6 本目を足す理由が無い（保守対象を増やさない）。
  // セレクタは `process.env` ノード自体に当たるので、`process.env.FOO`・
  // `process.env[name]`・`const { FOO } = process.env` の 3 形すべてを 1 本で捕まえる。
  //
  // **eslint-suppressions.json への grandfather は 0 件**。着手時点の違反
  // 141 件 / 62 ファイルは全件移行した（例外表を用意していたが使わずに済んだ）。
  // 憲章 R8 の「全件移行 + 再流入止めで 1 セット」は残件ゼロで満たしている。
  //
  // 逃げ道は 1 箇所だけあり、inline disable で明示してある:
  //   app/__fixtures__/origin-leak/origin-like.ts
  // これは `__tests__/auth-cookie-registry.test.ts` の negative fixture で、
  // **生読みそのものが検査対象**（AST スキャナがそれを報告できることを assert
  // している）。書き換えるとスキャナが何も報告しなくなり、「スキャナが動いて
  // いる証拠」が消える。同じ欠陥を別々に見張る 2 つのガードなので、片方を武装
  // させる fixture がもう片方から外れるのは正しい。
  //
  // したがって新しい違反は 1 件目から落ちる。将来どうしても例外が要るなら
  // `eslint --suppress-rule no-restricted-syntax` で eslint-suppressions.json に
  // 件数付きで記録する（`pnpm lint:prune-suppressions` で縮小方向にのみ更新）。
  // 記録に残さず済ませる逃げ道は用意しない。
  {
    files: [
      "app/**/*.ts",
      "app/**/*.tsx",
      "components/**/*.ts",
      "components/**/*.tsx",
      "lib/**/*.ts",
      "lib/**/*.tsx",
      "middleware.ts",
      "instrumentation.ts",
    ],
    ignores: [
      // 唯一の例外。ここが `process.env` を読む場所であり、読み方の正本。
      "lib/config/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'process.env を直接読まない。lib/config/spec.ts に宣言して env("NAME") で読む ' +
            "(憲章 R4)。理由: 生読みは値の正規化と『未設定とは何か』を呼び出し側ごとに" +
            "再定義し、実際に sitemap 全 172 件と LINE 連携を本番で壊している。",
        },
      ],
    },
  },
];

export default eslintConfig;
