import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { redirectsToText, run } from './gen-redirects.mjs'

test('redirectsToText emits sorted `<from> <to> 301` lines', () => {
  const txt = redirectsToText([
    { from: '/b', to: '/y' },
    { from: '/a', to: '/x' }
  ])
  assert.equal(txt, '/a /x 301\n/b /y 301\n')
})

test('run() seeds a snapshot, then emits a 301 when a slug is renamed (cid stays)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'setu-redir-'))
  const post = path.join(root, 'content', 'post', 'en')
  mkdirSync(post, { recursive: true })
  const contentDir = path.join(root, 'content')
  const publicRedirects = path.join(root, '_redirects')
  const cid = 'aaaaaaaa-1111-4111-8111-111111111111'
  writeFileSync(
    path.join(post, 'old-slug.mdoc'),
    `---\ncid: ${cid}\ntitle: T\n---\n\nbody\n`
  )
  try {
    // First run seeds the snapshot; no prior state → no redirects.
    const first = await run(contentDir, { publicRedirects })
    assert.deepEqual(first, [])
    assert.match(
      readFileSync(path.join(root, 'url-map.json'), 'utf8'),
      new RegExp(cid)
    )

    // Rename the slug — the file (and its cid) move to a new path.
    renameSync(
      path.join(post, 'old-slug.mdoc'),
      path.join(post, 'new-slug.mdoc')
    )

    const second = await run(contentDir, { publicRedirects })
    assert.deepEqual(second, [{ from: '/post/old-slug', to: '/post/new-slug' }])
    assert.equal(
      readFileSync(publicRedirects, 'utf8'),
      '/post/old-slug /post/new-slug 301\n'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('run() emits nothing for a cid-less entry (untracked until backfilled)', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'setu-redir-'))
  const post = path.join(root, 'content', 'post', 'en')
  mkdirSync(post, { recursive: true })
  const contentDir = path.join(root, 'content')
  const publicRedirects = path.join(root, '_redirects')
  writeFileSync(path.join(post, 'old.mdoc'), '---\ntitle: T\n---\n\nbody\n')
  try {
    await run(contentDir, { publicRedirects })
    renameSync(path.join(post, 'old.mdoc'), path.join(post, 'new.mdoc'))
    const out = await run(contentDir, { publicRedirects })
    assert.deepEqual(out, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
