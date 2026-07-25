import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage } from '../src/index'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('storage-local — security + persistence', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('rejects path-traversal keys before touching disk', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
    const s = createLocalStorage({ dir, baseUrl: '/u' })
    await expect(
      s.put('../escape.txt', bytes('x'), { contentType: 'text/plain' })
    ).rejects.toThrow()
    await expect(
      s.put('/etc/passwd', bytes('x'), { contentType: 'text/plain' })
    ).rejects.toThrow()
    await expect(s.get('a/../../b')).rejects.toThrow()
  })

  it('persists bytes + contentType across adapter instances on the same dir', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
    const a = createLocalStorage({ dir, baseUrl: '/u' })
    await a.put('media/1/original.png', bytes('IMG'), {
      contentType: 'image/png'
    })
    const b = createLocalStorage({ dir, baseUrl: '/u' })
    const got = await b.get('media/1/original.png')
    expect(new TextDecoder().decode(got!.body)).toBe('IMG')
    expect(got!.contentType).toBe('image/png')
  })

  it('trims a run of trailing slashes off baseUrl for url() (#340)', () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
    const s = createLocalStorage({ dir, baseUrl: 'https://cdn.test///' })
    expect(s.url('media/1/x.png')).toBe('https://cdn.test/media/1/x.png')
  })

  // #896: `dir` comes from SETU_MEDIA_DIR, and normalize() keeps a trailing
  // separator, so `root + sep` became '//' and EVERY key failed containment —
  // reported as a path-traversal rejection, which misdirects the investigation.
  // Every other test here builds `dir` from mkdtemp, which never has one.
  describe('a dir with trailing separators (#896)', () => {
    it('round-trips put/get/exists/delete/list', async () => {
      dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
      const s = createLocalStorage({ dir: `${dir}/`, baseUrl: '/u' })
      await s.put('a/b.png', bytes('IMG'), { contentType: 'image/png' })
      expect(new TextDecoder().decode((await s.get('a/b.png'))!.body)).toBe(
        'IMG'
      )
      expect((await s.get('a/b.png'))!.contentType).toBe('image/png')
      expect(await s.exists('a/b.png')).toBe(true)
      expect(await s.list()).toEqual(['a/b.png'])
      await s.delete('a/b.png')
      expect(await s.exists('a/b.png')).toBe(false)
    })

    it('writes to the same place as the slashless form', async () => {
      dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
      const withSlash = createLocalStorage({ dir: `${dir}///`, baseUrl: '/u' })
      await withSlash.put('a/b.png', bytes('IMG'), { contentType: 'image/png' })
      const without = createLocalStorage({ dir, baseUrl: '/u' })
      expect(
        new TextDecoder().decode((await without.get('a/b.png'))!.body)
      ).toBe('IMG')
      expect(await without.list()).toEqual(['a/b.png'])
    })

    // The bug was a false POSITIVE on the containment check; stripping the
    // trailing separator must not turn it into a false negative.
    it('still rejects traversal keys', async () => {
      dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
      const s = createLocalStorage({ dir: `${dir}/`, baseUrl: '/u' })
      await expect(
        s.put('../escape.txt', bytes('x'), { contentType: 'text/plain' })
      ).rejects.toThrow()
      await expect(
        s.put('/etc/passwd', bytes('x'), { contentType: 'text/plain' })
      ).rejects.toThrow()
      await expect(s.get('a/../../b')).rejects.toThrow()
      await expect(
        s.put('.meta/x', bytes('x'), { contentType: 'text/plain' })
      ).rejects.toThrow()
      await expect(
        s.put('   ', bytes('x'), { contentType: 'text/plain' })
      ).rejects.toThrow()
    })
  })

  it('does not catastrophically backtrack on an adversarial baseUrl (#340)', () => {
    // The old `/\/+$/` baseUrl trim was quadratic on this shape.
    dir = mkdtempSync(join(tmpdir(), 'setu-storage-'))
    const evil = 'https://cdn.test' + '/'.repeat(100_000)
    const t = performance.now()
    const s = createLocalStorage({ dir, baseUrl: evil })
    expect(s.url('k')).toBe('https://cdn.test/k')
    expect(performance.now() - t).toBeLessThan(1000)
  })
})
