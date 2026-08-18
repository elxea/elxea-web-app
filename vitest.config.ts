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
          // Vitest's default is 5s. Several unit tests do a *cold* dynamic
          // `import()` of a Next.js app module (`@/app/sitemap` pulls in the
          // whole route module graph, which Vite has to transform on first
          // touch). That single import measured 5.4s on this machine while the
          // `storybook` browser project ran in parallel and competed for CPU —
          // so `__tests__/site-url-consumers.test.ts` failed with "Test timed
          // out in 5000ms" under load while passing in isolation.
          //
          // This is machine speed, not a defect the test exists to catch. The
          // assertions are unchanged and a genuinely hung test still fails,
          // just 20s later. Do NOT raise this again to silence a red test — if
          // something needs more than 20s, that is itself the finding.
          testTimeout: 20_000,
          hookTimeout: 20_000,
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
                // Two stories (`components/viz/terroir/*-map.stories.tsx`)
                // mount MapLibre GL, which needs a **WebGL2** context. Headless
                // Chromium on a machine with no usable GPU stack has none, so
                // MapLibre throws `GPUInitializationError` and those stories
                // fail for a reason that has nothing to do with the component.
                //
                // These flags give Chromium SwiftShader — a software GL
                // implementation — so WebGL2 exists everywhere: this Mac, the
                // GitHub Actions runner, and any container. Since Chromium 128
                // software WebGL must be opted into explicitly, hence
                // `--enable-unsafe-swiftshader` ("unsafe" = no GPU sandbox
                // acceleration, not a security relaxation of the page).
                //
                // This makes the map stories RUN. It does not skip or weaken
                // them: interaction and axe assertions are unchanged.
                args: [
                  '--use-gl=angle',
                  '--use-angle=swiftshader',
                  '--enable-unsafe-swiftshader',
                ],
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
