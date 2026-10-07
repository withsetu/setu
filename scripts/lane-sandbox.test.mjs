import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { laneSandbox, laneSandboxFor } from './lane-sandbox.mjs'

test('every lane shares <main>/.content-sandbox/dev by default (#1053, #1200)', () => {
  assert.deepEqual(laneSandbox('/repo', {}), {
    dir: path.join('/repo', '.content-sandbox', 'dev'),
    owned: true
  })
})

test('an operator SETU_REPO_DIR in the main .env wins, and is not ours to seed or reset', () => {
  assert.deepEqual(laneSandbox('/repo', { SETU_REPO_DIR: '/data/site' }), {
    dir: '/data/site',
    owned: false
  })
})

test('a blank SETU_REPO_DIR counts as unset', () => {
  assert.equal(laneSandbox('/repo', { SETU_REPO_DIR: '  ' }).owned, true)
})

test('laneSandboxFor resolves the MAIN checkout from inside a worktree, and reads its .env', () => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'setu-lanesb-')))
  const repo = path.join(base, 'repo')
  const wt = path.join(repo, '.claude', 'worktrees', 'feature')
  const git = (cwd, args) =>
    execFileSync('git', args, {
      cwd,
      stdio: 'ignore',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }
    })
  try {
    mkdirSync(repo, { recursive: true })
    git(repo, ['init', '-q'])
    git(repo, [
      '-c',
      'user.email=t@e.st',
      '-c',
      'user.name=T',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'i'
    ])
    git(repo, ['worktree', 'add', '-q', wt, '-b', 'wt'])

    const fromWorktree = laneSandboxFor(path.join(wt))
    assert.equal(
      fromWorktree.dir,
      path.join(repo, '.content-sandbox', 'dev'),
      'a worktree resolves the shared sandbox, not one of its own'
    )
    assert.equal(fromWorktree.mainRoot, repo)

    writeFileSync(path.join(repo, '.env'), 'SETU_REPO_DIR=/elsewhere\n')
    assert.equal(laneSandboxFor(wt).dir, '/elsewhere')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('outside any git repo it degrades to the directory itself rather than throwing', () => {
  const dir = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'setu-lanesb-nogit-'))
  )
  try {
    const res = laneSandboxFor(dir, { gitCeiling: dir })
    assert.equal(res.mainRoot, dir)
    assert.equal(res.dir, path.join(dir, '.content-sandbox', 'dev'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
