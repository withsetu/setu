// #814: seed-recipes.mjs used to `await main()` at top level with no direct-invocation guard, so
// merely IMPORTING it wiped and rewrote `.content-sandbox/<name>/content`. That is why it had no
// test file. These tests exist to keep the module importable — and to keep its unvalidated `name`
// (which reaches an `rmSync`) routed through content-sandbox.mjs's validator.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Deliberately a DYNAMIC import: the point of the assertion is what happens at import time, so the
// "before" observation has to be taken first. A static import would run the module before any test
// body does.
test('importing the seeder runs nothing — no sandbox is created or wiped', async () => {
  const recipes = path.join(ROOT, '.content-sandbox', 'recipes')
  const before = existsSync(recipes)
  const mod = await import('./seed-recipes.mjs')
  assert.equal(
    existsSync(recipes),
    before,
    'import must not create or touch .content-sandbox/recipes'
  )
  assert.equal(typeof mod.parseSeedArgs, 'function')
  assert.equal(typeof mod.seedPaths, 'function')
})

test('parseSeedArgs reads the name, --refresh and --count', async () => {
  const { parseSeedArgs } = await import('./seed-recipes.mjs')
  assert.deepEqual(parseSeedArgs([]), {
    refresh: false,
    name: 'recipes',
    count: null
  })
  assert.deepEqual(parseSeedArgs(['--refresh', 'scale']), {
    refresh: true,
    name: 'scale',
    count: null
  })
  assert.deepEqual(parseSeedArgs(['--count=10', 'scale']), {
    refresh: false,
    name: 'scale',
    count: 10
  })
  assert.throws(() => parseSeedArgs(['--count=0']), /positive integer/)
  assert.throws(() => parseSeedArgs(['--count=abc']), /positive integer/)
})

test('seedPaths routes the name through the shared sandbox validator (#814)', async () => {
  const { seedPaths } = await import('./seed-recipes.mjs')
  // Happy path: everything lands under <root>/.content-sandbox/<name>/.
  const p = seedPaths('/tmp/root', 'recipes')
  assert.equal(p.sandbox, path.join('/tmp/root', '.content-sandbox', 'recipes'))
  assert.equal(
    p.outDir,
    path.join(
      '/tmp/root',
      '.content-sandbox',
      'recipes',
      'content',
      'post',
      'en'
    )
  )
  // KILL-SHOT: unvalidated, `name = '..'` made main()'s rmSync target <root>/content directly.
  for (const bad of ['..', '../..', '', 'a/b', '/etc', '-rf'])
    assert.throws(
      () => seedPaths('/tmp/root', bad),
      /sandbox name/i,
      `expected seedPaths to refuse ${JSON.stringify(bad)}`
    )
})
