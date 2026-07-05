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
})
