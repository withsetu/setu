import { describe, it, expect, beforeEach } from 'vitest'
import type { StoragePort } from '@setu/core'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)
const text = (b: Uint8Array): string => new TextDecoder().decode(b)

/** Run the StoragePort behavioural contract against an adapter. `makeAdapter` must
 *  return a FRESH, empty store on each call. */
export function runStoragePortContract(makeAdapter: () => Promise<StoragePort> | StoragePort): void {
  describe('StoragePort contract', () => {
    let s: StoragePort
    beforeEach(async () => {
      s = await makeAdapter()
    })

    it('returns null for an absent key', async () => {
      expect(await s.get('missing/x.bin')).toBeNull()
    })

    it('round-trips exact bytes and contentType through put/get', async () => {
      await s.put('a/b.txt', bytes('hello'), { contentType: 'text/plain' })
      const got = await s.get('a/b.txt')
      expect(got).not.toBeNull()
      expect(Array.from(got!.body)).toEqual(Array.from(bytes('hello')))
      expect(text(got!.body)).toBe('hello')
      expect(got!.contentType).toBe('text/plain')
    })

    it('put overwrites an existing key', async () => {
      await s.put('k', bytes('one'), { contentType: 'text/plain' })
      await s.put('k', bytes('two'), { contentType: 'text/markdown' })
      const got = await s.get('k')
      expect(text(got!.body)).toBe('two')
      expect(got!.contentType).toBe('text/markdown')
    })

    it('exists reflects put + delete, and delete is idempotent', async () => {
      expect(await s.exists('k')).toBe(false)
      await s.put('k', bytes('x'), { contentType: 'application/octet-stream' })
      expect(await s.exists('k')).toBe(true)
      await s.delete('k')
      expect(await s.exists('k')).toBe(false)
      await s.delete('k') // no throw on absent
      expect(await s.get('k')).toBeNull()
    })

    it('keeps object keys and stored metadata in separate namespaces (no sidecar collision)', async () => {
      await s.put('a', bytes('A-body'), { contentType: 'image/png' })
      await s.put('a.ctype', bytes('CT-body'), { contentType: 'text/plain' })
      const a = await s.get('a')
      const act = await s.get('a.ctype')
      expect(text(a!.body)).toBe('A-body')
      expect(a!.contentType).toBe('image/png')   // NOT clobbered by put('a.ctype')
      expect(text(act!.body)).toBe('CT-body')    // a real object, not a's content-type string
      expect(act!.contentType).toBe('text/plain')
    })

    it('url(key) contains the key', async () => {
      expect(s.url('media/abc/original.jpg')).toContain('media/abc/original.jpg')
    })
  })
}
