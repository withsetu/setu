import { defineConfig, mergeConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// REAL I/O: every test here shells out to the `git` binary (init, add, commit, log) against
// a throwaway repo on the real filesystem. A cold CI runner with a contended CPU and no
// warm page cache routinely spends multiple seconds inside a single `git commit`, so
// vitest's 5s default is a coin flip rather than a hang detector (#818; related flakes
// #718, #684, #636). 30s is generous for a subprocess that normally takes tens of
// milliseconds while still failing fast on an actual deadlock — it is a hang gate, not a
// blank cheque. hookTimeout is doubled because per-suite setup does the repo scaffolding.
export default mergeConfig(
  shared,
  defineConfig({
    test: { testTimeout: 30_000, hookTimeout: 60_000 }
  })
)
