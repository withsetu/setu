import { defineConfig, mergeConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// core is the only package with COLOCATED tests (43 files under src/**), alongside the
// repo-standard test/** tree. mergeConfig concatenates `include`, so this widens the
// shared glob rather than replacing it (#818).
export default mergeConfig(
  shared,
  defineConfig({
    test: { include: ['src/**/*.test.ts'] }
  })
)
