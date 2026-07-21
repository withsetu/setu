// Tests for the login-link recovery script (#386 Task 2). Runs against temp roots (node:test),
// mirroring content-sandbox.test.mjs — no process.env mutation, env is passed explicitly.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  isDirectInvocation,
  openCommandFor,
  parseArgs,
  readLoginLink
} from './auth-login-link.mjs'

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), 'setu-login-link-'))
}

function writeHandshake(dir, url) {
  mkdirSync(path.join(dir, '.setu'), { recursive: true })
  writeFileSync(path.join(dir, '.setu', 'handshake-url'), `${url}\n`)
}

test('reads the handshake URL from the root itself (bare api run)', () => {
  const root = makeRoot()
  try {
    writeHandshake(root, 'http://localhost:5173/#setu-token=abc123')
    const { url, file } = readLoginLink(root, {})
    assert.equal(url, 'http://localhost:5173/#setu-token=abc123')
    assert.equal(file, path.join(root, '.setu', 'handshake-url'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('finds the pnpm-dev sandbox file (.content-sandbox/dev) before falling back to the root', () => {
  const root = makeRoot()
  try {
    const sandbox = path.join(root, '.content-sandbox', 'dev')
    writeHandshake(sandbox, 'http://localhost:5173/#setu-token=from-sandbox')
    // A stale root-level file must NOT win over the dev sandbox the running api writes to.
    writeHandshake(root, 'http://localhost:5173/#setu-token=stale-root')
    const { url } = readLoginLink(root, {})
    assert.equal(url, 'http://localhost:5173/#setu-token=from-sandbox')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('SETU_REPO_DIR takes precedence over the dev sandbox default', () => {
  const root = makeRoot()
  const other = makeRoot()
  try {
    writeHandshake(
      path.join(root, '.content-sandbox', 'dev'),
      'http://localhost:5173/#setu-token=from-sandbox'
    )
    writeHandshake(other, 'http://localhost:5173/#setu-token=from-env')
    const { url } = readLoginLink(root, { SETU_REPO_DIR: other })
    assert.equal(url, 'http://localhost:5173/#setu-token=from-env')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  }
})

test('missing file → helpful error naming pnpm dev and the checked paths', () => {
  const root = makeRoot()
  try {
    assert.throws(
      () => readLoginLink(root, {}),
      (err) => {
        assert.match(err.message, /pnpm dev/)
        assert.match(err.message, /handshake/i)
        assert.ok(
          err.message.includes(path.join(root, '.setu', 'handshake-url')),
          'error lists the checked path'
        )
        return true
      }
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('empty/whitespace-only file → same helpful error', () => {
  const root = makeRoot()
  try {
    writeHandshake(root, '   ')
    assert.throws(() => readLoginLink(root, {}), /pnpm dev/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// --open (#779): hand-transcribing a single-use, rotating token between terminal and browser is
// where sign-in failures came from. The no-flag behaviour must stay byte-identical.
test('parseArgs: --open opts in, no flag stays the default print-only behaviour', () => {
  assert.deepEqual(parseArgs([]), { open: false })
  assert.deepEqual(parseArgs(['--open']), { open: true })
  assert.deepEqual(parseArgs(['-o']), { open: true })
  assert.deepEqual(parseArgs(['--something-else']), { open: false })
})

test('openCommandFor: macOS/Linux openers, honest null elsewhere', () => {
  assert.deepEqual(openCommandFor('darwin'), { cmd: 'open', args: [] })
  assert.deepEqual(openCommandFor('linux'), { cmd: 'xdg-open', args: [] })
  assert.equal(openCommandFor('win32'), null)
  assert.equal(openCommandFor('sunos'), null)
})

// The direct-invocation guard compares FILESYSTEM PATHS, never string-built `file://` URLs: a
// path with URL-special characters (a space is %20 inside import.meta.url) must still register
// as a direct run — the naive `import.meta.url === `file://${argv1}`` template silently no-ops
// (exit 0, nothing printed) on exactly those paths.
test('isDirectInvocation: matches when argv[1] is the module, including URL-special paths', () => {
  const plain = '/tmp/setu/auth-login-link.mjs'
  assert.equal(isDirectInvocation(plain, pathToFileURL(plain).href), true)

  const withSpace = '/tmp/my dir/auth-login-link.mjs'
  const metaUrl = pathToFileURL(withSpace).href
  assert.match(metaUrl, /%20/, 'fixture really exercises URL-encoding')
  assert.equal(isDirectInvocation(withSpace, metaUrl), true)
  // The old template comparison is exactly what this guard must NOT be.
  assert.notEqual(metaUrl, `file://${withSpace}`)
})

test('isDirectInvocation: resolves a relative argv[1] against cwd', () => {
  const abs = path.resolve('auth-login-link.mjs')
  assert.equal(
    isDirectInvocation('auth-login-link.mjs', pathToFileURL(abs).href),
    true
  )
})

test('isDirectInvocation: false for a different module or a missing argv[1]', () => {
  const meta = pathToFileURL('/tmp/setu/auth-login-link.mjs').href
  assert.equal(isDirectInvocation('/tmp/setu/other-script.mjs', meta), false)
  assert.equal(isDirectInvocation(undefined, meta), false)
  assert.equal(isDirectInvocation('', meta), false)
})
