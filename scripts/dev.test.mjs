import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { dirForLane, laneForCwd, mainCheckout } from './dev.mjs'
import { MAIN_LANE } from './dev-lanes.mjs'

const ROOT = '/repo'
const WT = path.join(ROOT, '.claude', 'worktrees')

test('standing in the main checkout means the main lane', () => {
  assert.equal(laneForCwd(ROOT, ROOT), MAIN_LANE)
  assert.equal(laneForCwd(path.join(ROOT, 'apps', 'admin'), ROOT), MAIN_LANE)
})

test('standing anywhere inside a worktree means that worktree', () => {
  assert.equal(laneForCwd(path.join(WT, 'feature-x'), ROOT), 'feature-x')
  assert.equal(
    laneForCwd(path.join(WT, 'feature-x', 'apps', 'site'), ROOT),
    'feature-x',
    'a nested directory still resolves to the lane, so there is no cd-to-the-root rule'
  )
})

test('a path outside the repo falls back to the main lane rather than escaping', () => {
  assert.equal(laneForCwd('/somewhere/else', ROOT), MAIN_LANE)
  assert.equal(laneForCwd(path.join(ROOT, '..', 'sibling'), ROOT), MAIN_LANE)
})

test('dirForLane maps the main lane to the checkout and others under worktrees', () => {
  assert.equal(dirForLane(ROOT, MAIN_LANE), ROOT)
  assert.equal(dirForLane(ROOT, 'feature-x'), path.join(WT, 'feature-x'))
})

test('mainCheckout resolves the shared checkout from inside a worktree', () => {
  // Runs in THIS worktree, so a correct implementation must not return the worktree itself.
  const root = mainCheckout(process.cwd())
  assert.ok(path.isAbsolute(root))
  assert.ok(
    !path.relative(root, process.cwd()).startsWith('..'),
    'the cwd must live under the resolved main checkout'
  )
  assert.notEqual(
    root,
    process.cwd(),
    'a worktree is not its own main checkout'
  )
})
