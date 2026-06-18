import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Suites each run `astro build` into the shared dist/ in beforeAll; run files
  // sequentially so concurrent builds can't race on the same output directory.
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
