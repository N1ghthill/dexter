import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  use: {
    viewport: {
      width: 1440,
      height: 900
    },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'pt-BR'
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list'
});
