import { defineConfig, mergeConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// REAL I/O: drives the native better-sqlite3 binding against real database files, including
// migration runs. First touch in a cold process pays the native module load plus schema
// setup, which is exactly the work that overruns vitest's 5s default on a loaded CI runner
// (#818). Deliberately lower than git-local's 30s — no subprocess spawn here, so anything
// past 20s is a genuine lock/hang worth failing on.
export default mergeConfig(
  shared,
  defineConfig({
    test: { testTimeout: 20_000, hookTimeout: 30_000 }
  })
)
