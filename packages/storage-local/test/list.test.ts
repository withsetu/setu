import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage } from '../src/index'

async function tmp() {
  return mkdtemp(join(tmpdir(), 'setu-list-'))
}

describe('StoragePort.list (local)', () => {
  it('lists all keys recursively, excludes .meta, honours prefix', async () => {
    const dir = await tmp()
    try {
      const s = createLocalStorage({ dir, baseUrl: 'http://t/media' })
      await s.put('2026/06/cat.jpg', new Uint8Array([1]), {
        contentType: 'image/jpeg'
      })
      await s.put('2026/06/cat.media.json', new Uint8Array([2]), {
        contentType: 'application/json'
      })
      await s.put('2026/05/dog.png', new Uint8Array([3]), {
        contentType: 'image/png'
      })
      const all = (await s.list()).sort()
      expect(all).toEqual([
        '2026/05/dog.png',
        '2026/06/cat.jpg',
        '2026/06/cat.media.json'
      ])
      // .meta sidecars (written by put for content-type) are not surfaced
      expect(all.some((k) => k.startsWith('.meta'))).toBe(false)
      const june = (await s.list('2026/06/')).sort()
      expect(june).toEqual(['2026/06/cat.jpg', '2026/06/cat.media.json'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // #899: `.meta` is reserved as the FIRST key segment only (resolveKey), but list()
  // skipped any directory entry named `.meta` at every depth. So a key with `.meta`
  // deeper in the path stored fine and `exists()` said true, while `list()` dropped it —
  // silently losing the object for anything that rebuilds an index from list().
  it('only reserves .meta as the first segment, matching put/exists', async () => {
    const dir = await tmp()
    try {
      const s = createLocalStorage({ dir, baseUrl: 'http://t/media' })
      await s.put('uploads/.meta/real.png', new Uint8Array([1]), {
        contentType: 'image/png'
      })
      expect(await s.exists('uploads/.meta/real.png')).toBe(true)
      expect(await s.list()).toContain('uploads/.meta/real.png')
      // The root-level reserved namespace is still hidden.
      expect((await s.list()).some((k) => k.startsWith('.meta/'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns [] for an empty store', async () => {
    const dir = await tmp()
    try {
      expect(
        await createLocalStorage({ dir, baseUrl: 'http://t' }).list()
      ).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
