// Tests for the login-link recovery script (#386 Task 2). Runs against temp roots (node:test),
// mirroring content-sandbox.test.mjs — no process.env mutation, env is passed explicitly.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { readLoginLink } from './auth-login-link.mjs'

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
