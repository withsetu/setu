import { defineConfig } from 'vitest/config'

// Repo-wide vitest defaults (#818). Before this file there were two competing discovery
// contracts in one repo: 16 packages pinned `include: ['test/**/*.test.ts']` in an
// otherwise byte-identical 5-line config, while 9 packages plus apps/api had no config at
// all and ran on vitest's default `**/*.test.*` — which also walks dist/, fixtures and any
// future colocated file. Nothing was orphaned at the time, but the drift was silent, and
// "a test file that stops being collected" fails green.
//
// HOW PACKAGES CONSUME THIS
//   - No local overrides  -> `export { default } from '../../vitest.shared'` (one line).
//   - Local overrides     -> `mergeConfig(shared, defineConfig({ … }))`.
// Vite's `mergeConfig` CONCATENATES arrays, so a package that adds its own `include`
// (theme-default keeps its test files flat at the package root) ends up with the union of
// both globs rather than replacing this one. That is the intended behaviour: a package can
// widen discovery, never silently narrow it.
//
// TIMEOUTS ARE DELIBERATELY NOT SET HERE. vitest's 5s default is the right gate for pure
// logic, and raising it repo-wide would mask a genuine hang everywhere to accommodate the
// three suites that legitimately need longer (real `git` subprocesses in git-local, native
// better-sqlite3 in db-sqlite, a real chromium + full Tiptap/Radix mount in apps/admin's
// browser project, plus apps/site's real `astro build`). Those set their own, with a
// comment saying which real-world operation they are waiting on.
export default defineConfig({
  test: {
    // `{ts,tsx}` rather than the historical `.ts`: packages/blocks and
    // packages/email-templates render JSX in their suites. Widening the extension set
    // matches no additional file that exists today (verified by enumerating vitest's
    // collected file set before and after this change — see the #818 PR), it just stops
    // the next .tsx test from being silently invisible.
    include: ['test/**/*.test.{ts,tsx}']
  }
})
