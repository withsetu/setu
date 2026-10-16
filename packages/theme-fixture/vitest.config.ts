import { defineConfig, mergeConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// Flat package like theme-default: the .ts files and their tests sit at the package root.
export default mergeConfig(
  shared,
  defineConfig({
    test: { include: ['*.test.ts'] }
  })
)
