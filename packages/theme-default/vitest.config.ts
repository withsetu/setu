import { defineConfig, mergeConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// theme-default has no src/ or test/ dir — its .ts files (and their tests) sit flat at the
// package root, which is also how its tsconfig `include: ["*.ts"]` is written. Before #818
// this package had no vitest config at all and its three root-level suites were collected
// only by vitest's default `**/*.test.*`. mergeConfig concatenates `include`, so the shared
// test/** glob stays in place for anything added there later.
export default mergeConfig(
  shared,
  defineConfig({
    test: { include: ['*.test.ts'] }
  })
)
