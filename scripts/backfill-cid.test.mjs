import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { backfillCids } from './backfill-cid.mjs'

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'setu-cid-'))
  const post = path.join(dir, 'post', 'en')
  mkdirSync(post, { recursive: true })
  return { dir, post }
}

const UUID = /^cid: [0-9a-f-]{36}$/m

test('stamps a cid into a cid-less entry, preserving body + other frontmatter', () => {
  const { dir, post } = fixture()
  try {
    writeFileSync(
      path.join(post, 'a.mdoc'),
      '---\ntitle: A\n---\n\nbody text\n'
    )
    const n = backfillCids(dir, () => '11111111-1111-4111-8111-111111111111')
    assert.equal(n, 1)
    const out = readFileSync(path.join(post, 'a.mdoc'), 'utf8')
    assert.match(out, /cid: 11111111-1111-4111-8111-111111111111/)
    assert.match(out, /title: A/)
    assert.match(out, /body text/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('is idempotent — a second run stamps nothing and leaves files byte-identical', () => {
  const { dir, post } = fixture()
  try {
    writeFileSync(path.join(post, 'a.mdoc'), '---\ntitle: A\n---\n\nbody\n')
    backfillCids(dir)
    const after1 = readFileSync(path.join(post, 'a.mdoc'), 'utf8')
    assert.match(after1, UUID)
    const n2 = backfillCids(dir)
    assert.equal(n2, 0)
    assert.equal(readFileSync(path.join(post, 'a.mdoc'), 'utf8'), after1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('does not overwrite an existing valid cid', () => {
  const { dir, post } = fixture()
  try {
    const existing = 'abcdef01-2345-4678-89ab-cdef01234567'
    writeFileSync(
      path.join(post, 'a.mdoc'),
      `---\ncid: ${existing}\ntitle: A\n---\n\nbody\n`
    )
    const n = backfillCids(dir, () => 'ffffffff-ffff-4fff-8fff-ffffffffffff')
    assert.equal(n, 0)
    assert.match(
      readFileSync(path.join(post, 'a.mdoc'), 'utf8'),
      new RegExp(`cid: ${existing}`)
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
