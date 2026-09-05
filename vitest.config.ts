import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

import { playwright } from '@vitest/browser-playwright';

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

/**
 * Coverage is opt-in via `VITEST_COVERAGE=1` (see `pnpm test:coverage`) rather
 * than the `--coverage` CLI flag, for two reasons:
 *
 * 1. `--coverage` on argv breaks this config outright. `@chromatic-com/storybook`
 *    is loaded as a Storybook preset while the `storybook` project's config is
 *    built, and the bundled `chromatic` CLI parses `process.argv` looking for its
 *    own `coverage` option. It finds the boolean `true` and throws
 *    `TypeError: Cannot create property 'provider' on boolean 'true'`, which
 *    surfaces as `SB_CORE-SERVER_0002 CriticalPresetLoadError` and fails the run
 *    before a single test executes — even with `--project unit`.
 * 2. Keeping it off by default leaves `pnpm test` (the pre-push hook, which runs
 *    every project) as fast as it was.
 */
const coverageEnabled = process.env.VITEST_COVERAGE === '1';

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  test: {
    /**
     * 1 テストの上限時間。Vitest の既定 5,000ms から引き上げてある。
     *
     * このリポジトリでは branch protection が張れないため、壊れたコードが main に
     * 入るのを止める唯一の機械強制が **pre-push フックの `pnpm test`** である
     * (CLAUDE.md「ローカル品質ゲート」)。ところが既定の 5,000ms は、テストの中身
     * ではなく **モジュールの transform / import** で使い切られることがある。実測
     * (2026-08-25) では全体の transform に 400-1,200 秒かかっており、機械が他の
     * 作業で混んでいると、単体では 1 秒未満で通るテストが「5,000ms を超えた」で
     * 落ちる。しかも落ちる顔ぶれが毎回変わる。
     *
     * 落ちる理由が変更内容と無関係なので、この状態は 2 つの害しかない —
     * (1) ゲートが信用できなくなる (2) `--no-verify` (禁止) への圧力になる。
     * 判定を緩めているのではなく、**待ち時間の上限だけ**を実測に合わせて広げる。
     * アサーションは 1 つも変えていない。本当に固まったテストは 30 秒で落ちる。
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    /**
     * 同時に走らせるワーカー数の上限。
     *
     * 既定はマシンの CPU 数いっぱいで、しかも**プロジェクトごとに**その数を取る
     * (unit と storybook で二重に取る)。この機械は複数の作業ツリーが同時に走る
     * 前提なので、既定のままだと CPU を奪い合って 1 テストあたりの実時間が
     * 桁で伸びる (2026-08-25 実測: load average 30 / transform 合計 4,378 秒 /
     * 上限 30,000ms でも毎回違う顔ぶれが時間切れ)。
     *
     * 上限を切ると全体の実時間はやや伸びるが、**1 本ずつには確実に CPU が回る**。
     * pre-push は「壊れたコードを止める」ための関門であって速さを競う場所では
     * ないので、速さより結果の再現性を採る。
     */
    maxWorkers: 4,
    coverage: {
      enabled: coverageEnabled,
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      // Setting `include` explicitly is what makes this a real ratchet. Vitest's
      // default is "only files a test imported", under which adding a brand-new
      // untested file would not appear in the report at all and coverage could
      // never go *down* — the exact blind spot this gate exists to close. With
      // `include` set, every matching file is counted whether a test touched it
      // or not. (In Vitest 3 this needed `coverage.all: true`; that option was
      // removed in Vitest 4, where `include` carries the behaviour on its own.)
      //
      // Scope is the surface the `unit` project actually aims at: server-side
      // logic and API routes. React components are verified by the `storybook`
      // project (a different runner) and would otherwise drown the signal with
      // ~146 files at 0%.
      include: ['lib/**/*.ts', 'app/api/**/*.ts', 'sanity/lib/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.test.ts', '**/__tests__/**'],
      // Pinned to the baseline **as measured in CI** (2026-08-10, run 31369760768),
      // truncated to 1 decimal so a threshold is never above what was measured:
      //   statements 28.11% (869/3091)   branches  29.49% (566/1919)
      //   functions  31.42% (154/490)    lines     28.03% (799/2850)
      //
      // Use the CI numbers, not local ones. Locally (macOS, Node v22.22.0, CI
      // unset) branches reads 29.65% = 569/1919 — same denominator, 3 more
      // covered branches, because a few branches under lib/ are env-dependent and
      // take the other path on the runner. Pinning to a local reading fails the
      // gate on every CI run over a difference that says nothing about test
      // quality. CI is where the gate runs, so CI is the number that counts.
      //
      // These are NOT a claim that ~28% is adequate — they are a ratchet. They
      // exist so that coverage going *down* fails the build instead of going
      // unnoticed. Raise them when tests are added; never lower them to make a
      // red build green. See docs/ci-gates.md.
      thresholds: {
        statements: 28.1,
        branches: 29.4,
        functions: 31.4,
        lines: 28.0,
      },
    },
    projects: [
      // Unit tests (Node environment)
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
          exclude: ['e2e/**', 'node_modules/**'],
          environment: 'node',
          globals: true,
          // Vitest 4 leaves NODE_ENV as 'development' here, so modules that
          // fail fast on missing production secrets unless NODE_ENV === 'test'
          // (e.g. lib/shopify/customer.ts guarding SESSION_SECRET) could not be
          // imported by a unit test at all. Declare the test environment
          // explicitly so those guards take their intended test path.
          env: {
            NODE_ENV: 'test',
          },
        },
        resolve: {
          alias: {
            '@': dirname,
            // `server-only` の条件解決 (`react-server`) は Next のバンドラだけが持つ。
            // Vitest はそれを持たないため本物 (常に throw) を掴んでしまう —
            // unit プロジェクトだけ無害なシムに差し替える。詳細は
            // `__tests__/helpers/server-only-empty.ts` のコメント。本番ビルドの
            // 解決には影響しない (Next 側は素の `server-only` を見続ける)。
            'server-only': path.join(dirname, '__tests__/helpers/server-only-empty.ts'),
          },
        },
      },
      // Storybook visual tests (browser environment)
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({ configDir: path.join(dirname, '.storybook') }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                // 一部の story (`components/viz/terroir/*-map.stories.tsx`) は
                // MapLibre GL = WebGL2 コンテキストを要求する。使える GPU
                // スタックが無いホスト (例: このリポの headless Chromium が
                // ハードウェア GL を掴めないマシン) では `GPUInitializationError`
                // で落ち、そのマシンからの storybook プロジェクト実行が
                // 全滅する (再現・実測: このセッションで origin/main
                // 未変更のまま同じ失敗を確認済み)。
                //
                // Chromium に SwiftShader (ソフトウェア WebGL2 実装) を渡すと
                // Mac・Actions runner・コンテナのどこでも動く。skip でも
                // 緩和でもない — interaction / axe のアサーションは不変。
                // 前例: 2026-08-19 に同じ根本原因で一度導入されたが、その後
                // main の履歴からこの変更だけが失われていた
                // (`git log --follow -- vitest.config.ts` で該当コミットが
                // 現行 main の系譜に無いことを確認)。
                args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
});
