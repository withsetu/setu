import { test } from '@playwright/test'

// Concurrency-safety: chromium and webkit-editor (and any other project) run specs in
// parallel against ONE shared sandbox, and the admin has pessimistic post-locking. A
// title embedding the project name + a random token means no two projects (or re-runs
// within the same sandbox) ever mint the same slug.
//
// Exception: e2e/specs/screens.visual.spec.ts deliberately does NOT use this helper.
// Screenshot diffing needs byte-stable fixture titles/content run over run, and a random
// token would make every baseline stale on every run. This is safe for two independent
// reasons: (1) the sandbox is wiped + reseeded per run (webServer.command in
// playwright.config.ts), and (2) drafts live in the browser's IndexedDB, scoped to one
// Playwright browser context (apps/admin/src/data/Bootstrap.tsx's createIdbDataPort) —
// NOT server-shared — so a fixed-title draft created in one test's context can never
// collide with the same fixed title used in another test's fresh context, even within the
// same file. Only PUBLISHED content (a real git commit, e.g. publish.spec.ts) is
// server-shared across every project/context; that path still uses this helper.
export function uniqueTitle(label: string) {
  const token = Math.random().toString(36).slice(2, 8)
  return `${test.info().project.name} ${label} ${token}`
}
