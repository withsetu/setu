// Smoke test for the content sandbox manager. Runs against a temp repo root (node:test).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  assertContained,
  cloneSandbox,
  resetSandbox,
  SANDBOX_ROOT,
  sandboxPath,
  seedSandbox
} from './content-sandbox.mjs'

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
    const marker = path.join(
      sandboxPath(root, 'dev'),
      'content',
      'edited-by-uat.mdoc'
    )
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
    const marker = path.join(
      sandboxPath(root, 'dev'),
      'content',
      'edited-by-uat.mdoc'
    )
    writeFileSync(marker, 'x')
    resetSandbox(root, 'dev')
    assert.ok(!existsSync(marker), 'UAT change was blasted')
    assert.ok(
      existsSync(
        path.join(
          sandboxPath(root, 'dev'),
          'content',
          'post',
          'en',
          'hello.mdoc'
        )
      ),
      're-seeded from canonical'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --- #814: the name is an rm -rf target, so it must be validated at the choke point ---
//
// KILL-SHOT DESIGN: each case asserts BOTH that the call throws AND that a sentinel file
// planted outside the sandbox root still exists. Delete the validator in sandboxPath and
// every one of these goes red (the traversal cases delete the sentinel; the others stop
// throwing) — they cannot pass against an unguarded script.
const BAD_NAMES = [
  '..',
  '../..',
  '',
  'a/b',
  '/etc',
  '-rf',
  '.',
  'a/../..',
  '..\\x'
]

function makeRootWithSentinel() {
  const root = makeRoot()
  writeFileSync(path.join(root, 'SENTINEL'), 'do not delete me\n')
  mkdirSync(path.join(root, SANDBOX_ROOT), { recursive: true })
  writeFileSync(path.join(root, SANDBOX_ROOT, 'SENTINEL'), 'sibling sandbox\n')
  return root
}

for (const name of BAD_NAMES) {
  test(`resetSandbox refuses the unsafe name ${JSON.stringify(name)} and deletes nothing`, () => {
    const root = makeRootWithSentinel()
    try {
      assert.throws(
        () => resetSandbox(root, name),
        /sandbox name/i,
        `expected resetSandbox to refuse ${JSON.stringify(name)}`
      )
      assert.ok(
        existsSync(path.join(root, 'SENTINEL')),
        'file outside the sandbox root survived'
      )
      assert.ok(
        existsSync(path.join(root, SANDBOX_ROOT, 'SENTINEL')),
        'sibling sandboxes survived'
      )
      assert.ok(
        existsSync(path.join(root, 'content', 'post', 'en', 'hello.mdoc')),
        'canonical content/ survived'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test(`seedSandbox refuses the unsafe name ${JSON.stringify(name)}`, () => {
    const root = makeRootWithSentinel()
    try {
      assert.throws(() => seedSandbox(root, name), /sandbox name/i)
      assert.ok(existsSync(path.join(root, 'SENTINEL')))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test('sandboxPath accepts ordinary slugs', () => {
  const root = '/tmp/x'
  for (const ok of ['dev', 'recipes', 'e2e-1', 'Dev_2', 'a.b'])
    assert.equal(sandboxPath(root, ok), path.join(root, SANDBOX_ROOT, ok))
  assert.equal(sandboxPath(root), path.join(root, SANDBOX_ROOT, 'dev'))
})

test('the containment assertion fires even if the name validator is bypassed', () => {
  // Belt-and-braces (#814 scope item 2): a future caller reaching assertContained with a
  // path outside <root>/.content-sandbox/ must be refused regardless of name validation.
  const root = mkdtempSync(path.join(tmpdir(), 'setu-contain-'))
  try {
    assert.throws(
      () => assertContained(root, path.join(root, 'content')),
      /outside/i
    )
    assert.throws(
      () => assertContained(root, path.join(root, SANDBOX_ROOT)),
      /outside/i
    )
    // The legitimate target passes.
    assertContained(root, path.join(root, SANDBOX_ROOT, 'dev'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a half-built sandbox (no .git) self-heals instead of sticking forever', () => {
  const root = makeRoot()
  try {
    // Simulate the #814 sticky state: the directory exists but git init/commit never ran.
    const dir = sandboxPath(root, 'dev')
    mkdirSync(path.join(dir, 'content'), { recursive: true })
    writeFileSync(path.join(dir, 'content', 'half.mdoc'), 'x')
    const seeded = seedSandbox(root, 'dev')
    assert.equal(
      seeded,
      true,
      'a sandbox without a HEAD is re-seeded, not skipped'
    )
    assert.ok(existsSync(path.join(dir, '.git')), 'sandbox is now a git repo')
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: 'pipe' })
    assert.ok(
      existsSync(path.join(dir, 'content', 'post', 'en', 'hello.mdoc')),
      're-seeded from canonical'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed seed leaves no directory behind (atomic build + rename)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'setu-atomic-'))
  try {
    // No content/ at all → git commit finds nothing to commit and exits non-zero.
    assert.throws(() => seedSandbox(root, 'dev'))
    const dir = sandboxPath(root, 'dev')
    assert.ok(!existsSync(dir), 'no half-built sandbox was left behind')
    assert.deepEqual(
      existsSync(path.join(root, SANDBOX_ROOT))
        ? readdirSync(path.join(root, SANDBOX_ROOT))
        : [],
      [],
      'no temp build directory was left behind'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// clone (#1051) — start a named sandbox from an existing one instead of from
// canonical content/, so a bootstrapped account and any UAT state travel with it.
// ---------------------------------------------------------------------------

test('clone copies an existing sandbox to a new name, git repo and all', () => {
  const root = makeRoot()
  try {
    seedSandbox(root, 'dev')
    writeFileSync(
      path.join(sandboxPath(root, 'dev'), 'marker.txt'),
      'carried\n'
    )

    const made = cloneSandbox(root, 'dev', 'feature-x')
    assert.equal(made, true)

    const dst = sandboxPath(root, 'feature-x')
    assert.ok(existsSync(path.join(dst, '.git')), 'clone is still a git repo')
    assert.equal(
      readFileSync(path.join(dst, 'marker.txt'), 'utf8'),
      'carried\n',
      'state present in the source travels to the clone'
    )
    assert.ok(
      existsSync(path.join(dst, 'content', 'post', 'en', 'hello.mdoc')),
      'seeded content is present too'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('clone refuses when the source does not exist', () => {
  const root = makeRoot()
  try {
    assert.throws(() => cloneSandbox(root, 'nope', 'target'), /nope/)
    assert.ok(!existsSync(sandboxPath(root, 'target')), 'no target created')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('clone refuses to clobber an existing target', () => {
  const root = makeRoot()
  try {
    seedSandbox(root, 'dev')
    seedSandbox(root, 'keep')
    writeFileSync(
      path.join(sandboxPath(root, 'keep'), 'precious.txt'),
      'keep\n'
    )

    assert.throws(() => cloneSandbox(root, 'dev', 'keep'), /already exists/)
    assert.equal(
      readFileSync(
        path.join(sandboxPath(root, 'keep'), 'precious.txt'),
        'utf8'
      ),
      'keep\n',
      'the existing sandbox is untouched'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('clone refuses invalid names at both ends, leaving anything outside the root alone', () => {
  for (const [from, to] of [
    ['..', 'ok'],
    ['dev', '..'],
    ['dev', 'a/b'],
    ['/etc', 'ok'],
    ['dev', '-rf'],
    ['dev', ''],
    ['dev', '.']
  ]) {
    const root = makeRootWithSentinel()
    try {
      seedSandbox(root, 'dev')
      assert.throws(
        () => cloneSandbox(root, from, to),
        `expected clone(${JSON.stringify(from)} -> ${JSON.stringify(to)}) to be refused`
      )
      assert.ok(
        existsSync(path.join(root, 'SENTINEL')),
        'sentinel outside the sandbox root survives'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('clone leaves no temp directory behind, on success or refusal', () => {
  const root = makeRoot()
  const tmpLeftovers = () =>
    readdirSync(path.join(root, SANDBOX_ROOT)).filter((e) =>
      e.includes('.tmp-')
    )
  try {
    seedSandbox(root, 'dev')

    cloneSandbox(root, 'dev', 'feature-y')
    assert.deepEqual(
      tmpLeftovers(),
      [],
      'no temp left after a successful clone'
    )

    // Refused because the target exists — the guard must fire BEFORE any temp is built.
    assert.throws(
      () => cloneSandbox(root, 'dev', 'feature-y'),
      /already exists/
    )
    assert.deepEqual(tmpLeftovers(), [], 'no temp left after a refused clone')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
