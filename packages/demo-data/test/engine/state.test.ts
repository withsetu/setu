import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_FILE,
  MANIFEST_FILE,
  clearCheckpoint,
  clearManifest,
  emptyCheckpoint,
  emptyManifest,
  loadCheckpoint,
  loadManifest,
  mergeManifest,
  runKeyOf,
  saveCheckpoint,
  saveManifest
} from '../../src/engine/state'

const tmp = () => mkdtemp(path.join(tmpdir(), 'demo-seed-state-'))

const identity = {
  packId: 'aic',
  posts: 100,
  users: { admin: 1, author: 2 },
  collection: 'post',
  locale: 'en',
  draftFraction: 0.1,
  imageWidthMix: [400, 843, 843, 1686],
  limitImages: null,
  relaxText: false
}

describe('runKeyOf', () => {
  it('is stable across key ordering and repeated calls', () => {
    const reordered = {
      ...identity,
      users: { author: 2, admin: 1 }
    }
    expect(runKeyOf(identity)).toBe(runKeyOf(reordered))
  })

  it('changes when any plan-shaping option changes', () => {
    const base = runKeyOf(identity)
    expect(runKeyOf({ ...identity, posts: 101 })).not.toBe(base)
    expect(runKeyOf({ ...identity, relaxText: true })).not.toBe(base)
    expect(runKeyOf({ ...identity, users: { admin: 2 } })).not.toBe(base)
    expect(runKeyOf({ ...identity, imageWidthMix: [400] })).not.toBe(base)
  })
})

describe('checkpoint', () => {
  it('round-trips through save/load for the same runKey', async () => {
    const dir = await tmp()
    const checkpoint = emptyCheckpoint('abc')
    checkpoint.images['101'] = { mediaKey: '1906/01/x', status: 'done' }
    checkpoint.chunksDone.push('demo-author-1@demo.setu.test#0')
    await saveCheckpoint(dir, checkpoint)
    expect(await loadCheckpoint(dir, 'abc')).toEqual(checkpoint)
  })

  it('discards a checkpoint from a different run', async () => {
    const dir = await tmp()
    const checkpoint = emptyCheckpoint('abc')
    checkpoint.chunksDone.push('x#0')
    await saveCheckpoint(dir, checkpoint)
    expect(await loadCheckpoint(dir, 'OTHER')).toEqual(emptyCheckpoint('OTHER'))
  })

  it('treats a missing or corrupt file as a fresh checkpoint', async () => {
    const dir = await tmp()
    expect(await loadCheckpoint(dir, 'abc')).toEqual(emptyCheckpoint('abc'))
    await mkdir(path.join(dir, '.setu'), { recursive: true })
    await writeFile(
      path.join(dir, '.setu', CHECKPOINT_FILE),
      '{not json',
      'utf8'
    )
    expect(await loadCheckpoint(dir, 'abc')).toEqual(emptyCheckpoint('abc'))
  })

  it('clears', async () => {
    const dir = await tmp()
    await saveCheckpoint(dir, emptyCheckpoint('abc'))
    await clearCheckpoint(dir)
    await expect(
      readFile(path.join(dir, '.setu', CHECKPOINT_FILE), 'utf8')
    ).rejects.toThrow()
  })
})

describe('manifest', () => {
  it('merges append-safely with per-list dedupe', () => {
    const base = mergeManifest(emptyManifest(), {
      posts: [{ collection: 'post', locale: 'en', slug: 'a', packId: '1' }],
      mediaKeys: ['1906/01/a'],
      users: [{ email: 'demo-admin-1@demo.setu.test', role: 'admin' }],
      categories: ['textiles']
    })
    const merged = mergeManifest(base, {
      posts: [
        { collection: 'post', locale: 'en', slug: 'a', packId: '1' }, // dupe
        { collection: 'post', locale: 'en', slug: 'b', packId: '2' }
      ],
      mediaKeys: ['1906/01/a', '1907/02/b'],
      users: [
        { email: 'demo-admin-1@demo.setu.test', role: 'admin' }, // dupe
        { email: 'demo-author-1@demo.setu.test', role: 'author' }
      ],
      categories: ['textiles', 'prints']
    })
    expect(merged.posts.map((p) => p.slug)).toEqual(['a', 'b'])
    expect(merged.mediaKeys).toEqual(['1906/01/a', '1907/02/b'])
    expect(merged.users.map((u) => u.email)).toEqual([
      'demo-admin-1@demo.setu.test',
      'demo-author-1@demo.setu.test'
    ])
    expect(merged.categories).toEqual(['textiles', 'prints'])
  })

  it('round-trips through save/load; missing or corrupt file is empty', async () => {
    const dir = await tmp()
    expect(await loadManifest(dir)).toEqual(emptyManifest())
    const manifest = mergeManifest(emptyManifest(), {
      categories: ['textiles']
    })
    await saveManifest(dir, manifest)
    expect(await loadManifest(dir)).toEqual(manifest)
    await writeFile(path.join(dir, '.setu', MANIFEST_FILE), 'nope', 'utf8')
    expect(await loadManifest(dir)).toEqual(emptyManifest())
  })

  it('clears', async () => {
    const dir = await tmp()
    await saveManifest(dir, emptyManifest())
    await clearManifest(dir)
    expect(await loadManifest(dir)).toEqual(emptyManifest())
  })
})
