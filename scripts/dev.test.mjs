import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
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

test('mainCheckout resolves the shared checkout from inside a real worktree', () => {
  // Builds an actual git repo + linked worktree rather than asserting something about wherever
  // this suite happens to run: the first version of this test asserted `root !== cwd`, which is
  // only true when the runner sits inside a worktree. It passed locally and failed on CI, which
  // runs from a plain checkout where returning the cwd is the CORRECT answer.
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'setu-mainco-')))
  const repo = path.join(base, 'repo')
  const linked = path.join(base, 'linked')
  const git = (cwd, args) =>
    execFileSync('git', args, {
      cwd,
      stdio: 'ignore',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }
    })
  try {
    mkdirSync(repo, { recursive: true })
    git(repo, ['init', '-q'])
    git(repo, ['config', 'user.email', 't@e.st'])
    git(repo, ['config', 'user.name', 'T'])
    writeFileSync(path.join(repo, 'f'), 'x\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'init'])
    git(repo, ['worktree', 'add', '-q', linked, '-b', 'wt'])

    assert.equal(
      realpathSync(mainCheckout(linked)),
      repo,
      'from a worktree: the main checkout'
    )
    assert.equal(
      realpathSync(mainCheckout(repo)),
      repo,
      'from the checkout itself: itself'
    )
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
