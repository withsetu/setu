import { test } from '@playwright/test'

// Concurrency-safety: chromium and webkit-editor (and any other project) run specs in
// parallel against ONE shared sandbox, and the admin has pessimistic post-locking. A
// title embedding the project name + a random token means no two projects (or re-runs
// within the same sandbox) ever mint the same slug.
export function uniqueTitle(label: string) {
  const token = Math.random().toString(36).slice(2, 8)
  return `${test.info().project.name} ${label} ${token}`
}
