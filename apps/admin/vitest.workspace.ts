import { defineWorkspace } from 'vitest/config'

// Two vitest "projects" sharing one `vitest run` invocation (#293):
//   - vite.config.ts's existing `test` block — jsdom, apps/admin/test/**, UNTOUCHED
//     (137 files / 523 tests at time of writing). This is where component LOGIC lives.
//   - vitest.browser.config.ts — real chromium via the playwright provider,
//     apps/admin/test-browser/**. This is where REAL DOM/portal/focus interaction
//     lives — the class of bug jsdom structurally cannot catch (see that config's
//     header comment for the BlockInspector/Radix history).
// Split, not migrate: nothing moves from test/ to test-browser/; the two suites cover
// different concerns (jsdom = logic, browser = interaction) and both run under one
// `vitest run` / `pnpm test`.
export default defineWorkspace([
  './vite.config.ts',
  './vitest.browser.config.ts'
])
