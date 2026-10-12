// #1207: the site generators must replace their outputs atomically, so a concurrent run of the
// same generator (turbo's parallel @setu/site#test + #lint, or `pnpm dev`'s predev alongside a
// turbo task) can never observe a truncated file.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
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
import { fileURLToPath } from 'node:url'

import { writeFileAtomic } from './atomic-write.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

test('writeFileAtomic replaces the file and leaves no temp file behind', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-atomic-write-'))
  try {
    const file = path.join(dir, 'out.json')
    writeFileSync(file, 'old')
    writeFileAtomic(file, 'new')
    assert.equal(readFileSync(file, 'utf8'), 'new')
    assert.deepEqual(readdirSync(dir), ['out.json'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeFileAtomic cleans up its temp file when the write fails', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-atomic-write-'))
  try {
    // Renaming a file over a non-empty directory fails AFTER the temp file was written.
    const target = path.join(dir, 'occupied')
    mkdirSync(target)
    writeFileSync(path.join(target, 'inside'), '')
    assert.throws(() => writeFileAtomic(target, 'y'))
    assert.deepEqual(readdirSync(dir), ['occupied'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a concurrent reader never observes a partially written file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-atomic-race-'))
  const file = path.join(dir, 'generated.json')
  // Large enough that a truncate-then-write is observable mid-flight by a tight read loop.
  const size = 4 * 1024 * 1024
  const a = 'a'.repeat(size)
  const b = 'b'.repeat(size)
  writeFileSync(file, a)
  const writer = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { writeFileAtomic } from ${JSON.stringify(path.join(here, 'atomic-write.mjs'))}
       const a = 'a'.repeat(${size}), b = 'b'.repeat(${size})
       for (let i = 0; i < 60; i++) writeFileAtomic(${JSON.stringify(file)}, i % 2 ? a : b)`
    ],
    { stdio: 'inherit' }
  )
  let exited = false
  const done = new Promise((resolve, reject) => {
    writer.on('error', reject)
    writer.on('exit', (code) => {
      exited = true
      if (code === 0) resolve()
      else reject(new Error(`writer exited ${code}`))
    })
  })
  let reads = 0
  const torn = []
  try {
    while (!exited) {
      const got = readFileSync(file, 'utf8')
      reads += 1
      if (got !== a && got !== b) torn.push(got.length)
      await new Promise((r) => setImmediate(r))
    }
    await done
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.ok(
    reads > 5,
    `reader sampled the file while writes were in flight (${reads} reads)`
  )
  assert.deepEqual(torn, [], 'every read saw a complete old or new file')
})

test('the site generators write their outputs through writeFileAtomic, never writeFileSync', () => {
  for (const name of [
    'gen-blocks.mjs',
    'gen-relations.mjs',
    'gen-redirects.mjs'
  ]) {
    const src = readFileSync(path.join(here, name), 'utf8')
    assert.doesNotMatch(
      src,
      /\bwriteFileSync\s*\(/,
      `${name} must not truncate-and-write a shared generated file`
    )
    assert.match(
      src,
      /from '\.\/atomic-write\.mjs'/,
      `${name} imports the atomic writer`
    )
  }
})

test('every turbo task that hashes a generator also hashes atomic-write.mjs', async () => {
  const { stripJsonComments } = await import('./turbo-api-deps.test.mjs')
  const turbo = JSON.parse(
    stripJsonComments(readFileSync(path.join(here, '..', 'turbo.json'), 'utf8'))
  )
  const gens = /scripts\/gen-(blocks|relations|redirects)\.mjs$/
  const tasks = Object.entries(turbo.tasks).filter(([, t]) =>
    (t.inputs ?? []).some((i) => gens.test(i))
  )
  assert.ok(tasks.length > 0)
  for (const [name, t] of tasks)
    assert.ok(
      t.inputs.includes('../../scripts/atomic-write.mjs'),
      `${name} hashes a generator but not the atomic writer it imports`
    )
})
