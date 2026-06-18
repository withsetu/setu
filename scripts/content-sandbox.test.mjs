// Smoke test for the content sandbox manager. Runs against a temp repo root (node:test).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { resetSandbox, sandboxPath, seedSandbox } from './content-sandbox.mjs'

function makeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'setu-sandbox-'))
  const fixture = path.join(root, 'content', 'post', 'en')
  mkdirSync(fixture, { recursive: true })
  writeFileSync(path.join(fixture, 'hello.mdoc'), '# hello\n')
  return root
}

test('seed copies canonical content/ into a git-repo sandbox', () => {
  const root = makeRoot()
  try {
    const seeded = seedSandbox(root, 'dev')
    assert.equal(seeded, true)
    const dir = sandboxPath(root, 'dev')
    assert.ok(existsSync(path.join(dir, '.git')), 'sandbox is a git repo')
    const copied = path.join(dir, 'content', 'post', 'en', 'hello.mdoc')
    assert.ok(existsSync(copied), 'content was copied')
    assert.equal(readFileSync(copied, 'utf8'), '# hello\n')
    // The seed is committed (HEAD resolves).
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: 'pipe' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('seed is a no-op when the sandbox already exists', () => {
  const root = makeRoot()
  try {
    seedSandbox(root, 'dev')
    const marker = path.join(sandboxPath(root, 'dev'), 'content', 'edited-by-uat.mdoc')
    writeFileSync(marker, 'x') // simulate UAT-created content
    const second = seedSandbox(root, 'dev')
    assert.equal(second, false, 'second seed is a no-op')
    assert.ok(existsSync(marker), 'existing sandbox content was preserved')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reset wipes UAT changes and re-seeds from canonical', () => {
  const root = makeRoot()
  try {
    seedSandbox(root, 'dev')
    const marker = path.join(sandboxPath(root, 'dev'), 'content', 'edited-by-uat.mdoc')
    writeFileSync(marker, 'x')
    resetSandbox(root, 'dev')
    assert.ok(!existsSync(marker), 'UAT change was blasted')
    assert.ok(
      existsSync(path.join(sandboxPath(root, 'dev'), 'content', 'post', 'en', 'hello.mdoc')),
      're-seeded from canonical',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
