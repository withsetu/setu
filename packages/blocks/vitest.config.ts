import { defineConfig, mergeConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// Block renderers mount React, so this suite needs a DOM and the testing-library setup
// file. Discovery itself comes from the shared config (#818).
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./test/setup.ts']
    }
  })
)
