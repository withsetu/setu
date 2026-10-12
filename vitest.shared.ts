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
//
// WORKER CAP (#1202). vitest's run-mode default is one worker per core minus one, chosen as if
// it had the machine to itself. Under `turbo run typecheck test lint` it never does: turbo
// runs several packages' tasks at once (see turbo.json's top-level `concurrency`), so on CI's
// 4-core ubuntu-latest runner each concurrent suite asked for 3 workers on top of tsc and
// eslint processes — a contributor to the load-only timeouts in #979 and #684. So the cap
// applies only when turbo is running the suite: turbo sets TURBO_HASH in every task's environment (documented
// at turborepo.dev/docs/reference/system-environment-variables), and that is exactly when
// other tasks compete for the cores. Under turbo each suite gets half the available
// parallelism; a standalone `pnpm --filter <pkg> test` keeps vitest's default, because alone
// on the machine the default is right (capping it measured ~30% slower for apps/api).
// Exported because apps/admin's root vitest.config.ts (a `test.projects` aggregator) does not
// merge this file and must apply the same cap itself. Every workspace vitest config running
// under this cap is enforced by scripts/vitest-worker-cap.test.mjs.
export const maxWorkers: string | undefined = process.env.TURBO_HASH
  ? '50%'
  : undefined

export default defineConfig({
  test: {
    maxWorkers,
    // `{ts,tsx}` rather than the historical `.ts`: packages/blocks renders JSX in its
    // suite (packages/email-templates did too, until #499 retired it). Widening the extension set
    // matches no additional file that exists today (verified by enumerating vitest's
    // collected file set before and after this change — see the #818 PR), it just stops
    // the next .tsx test from being silently invisible.
    include: ['test/**/*.test.{ts,tsx}']
  }
})
