// Guard for #1112: the four `@setu/site#*` tasks in turbo.json each override `inputs`, and an
// override REPLACES turbo's defaults — `$TURBO_DEFAULT$` reaches only `apps/site/`, so every
// content-repo-root file the site reads at build time has to be listed BY HAND.
//
// The list was assembled carefully for settings.json / url-map.json / redirects.json and then not
// re-derived when two more root reads appeared: taxonomy/categories.yaml (apps/site/src/lib/
// categories.ts) and theme-options.json (apps/site/src/lib/site-config.ts, and astro.config.mjs
// for the bundled font). A missing entry is invisible in every test and shows up only as a deploy
// that gets a cache hit and ships the previous build while reporting success — "Saved ≠ live" with
// the deploy doing the lying.
//
// Two properties are checked, because the drift came in both shapes: the required roots are all
// present, and the four lists agree with each other (adding a glob to #build but not #test is the
// same bug one task over).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripJsonComments } from './turbo-api-deps.test.mjs'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const turbo = JSON.parse(
  stripJsonComments(readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8'))
)

const SITE_TASKS = [
  '@setu/site#build',
  '@setu/site#test',
  '@setu/site#typecheck',
  '@setu/site#lint'
]

/** Every content-repo-root path `apps/site` reads during a build, as an `inputs` entry. Add to
 *  this list when the site gains a root-level read — that is the whole point of the guard. */
const REQUIRED_ROOT_INPUTS = [
  '$TURBO_DEFAULT$',
  '../../blocks/**',
  '../../content/**',
  '../../url-map.json',
  '../../redirects.json',
  '../../settings.json',
  '../../taxonomy/**',
  '../../theme-options.json'
]

for (const task of SITE_TASKS) {
  test(`${task} declares every content-root input`, () => {
    const inputs = turbo.tasks?.[task]?.inputs
    assert.ok(Array.isArray(inputs), `${task} has no inputs override`)
    for (const required of REQUIRED_ROOT_INPUTS) {
      assert.ok(
        inputs.includes(required),
        `${task} inputs is missing ${required} — an edit to it would replay a stale cached run`
      )
    }
  })
}

test('the four site tasks agree on their content-root inputs', () => {
  // Ignore each task's own extra entries (only #build/#test list gen-redirects.mjs); what must
  // not diverge is the set of root paths they all depend on.
  const rootsOf = (task) =>
    (turbo.tasks[task].inputs ?? [])
      .filter((i) => i.startsWith('../../') && !i.startsWith('../../scripts/'))
      .sort()
  const [first, ...rest] = SITE_TASKS
  for (const task of rest) {
    assert.deepEqual(
      rootsOf(task),
      rootsOf(first),
      `${task} and ${first} disagree about which content-root files matter`
    )
  }
})
