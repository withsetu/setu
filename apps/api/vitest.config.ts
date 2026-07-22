// Discovery contract lives in the repo-root vitest.shared.ts (#818). No local overrides.
// Added in #818: apps/api previously had NO config and ran on vitest's default
// `**/*.test.*` include. Its collected file set is unchanged (all 47 suites live under
// test/). No timeout override: these suites drive in-memory ports, not real I/O.
export { default } from '../../vitest.shared'
