import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

import { playwright } from '@vitest/browser-playwright';

const dirname =
  typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  test: {
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
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
});
