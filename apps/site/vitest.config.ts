import { defineConfig, mergeConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// REAL I/O: suites each run a full `astro build` into the shared dist/ in beforeAll, so the
// generous timeouts here are waiting on a real site build, not on logic. Files run
// sequentially (`fileParallelism: false`) so concurrent builds can't race on the same
// output directory. Discovery comes from the repo-root shared config (#818).
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      environment: 'node',
      testTimeout: 60_000,
      hookTimeout: 120_000,
      fileParallelism: false
    }
  })
)
