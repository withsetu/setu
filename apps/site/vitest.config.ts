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
      fileParallelism: false,
      // `astro build` refuses to run without SETU_SITE_URL (#1118). Every suite that builds the
      // site inherits this explicit test origin through process.env; a suite that asserts on a
      // different origin passes its own. apps/site/test/require-site-url.test.ts strips it to
      // prove the unset build fails.
      env: { SETU_SITE_URL: 'https://example.com' }
    }
  })
)
