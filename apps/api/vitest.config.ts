// Discovery contract lives in the repo-root vitest.shared.ts (#818). No local overrides.
// Added in #818: apps/api previously had NO config and ran on vitest's default
// `**/*.test.*` include; every suite lives under test/, so the collected set did not change.
// No suite-wide timeout override (#1202 corrected an earlier claim here that these suites
// "drive in-memory ports, not real I/O" — many do real I/O: sharp, better-sqlite3, the
// filesystem, git subprocesses). The intent is that a suite waiting on real I/O sets its own
// per-test or per-`vi.waitFor` timeout next to the operation it waits on (e.g.
// test/deploy.test.ts's REAL_IO_WAIT), rather than raising the default for every suite.
export { default } from '../../vitest.shared'
