import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalStorage } from '@setu/storage-local'
import { createUploadApi } from '../src/media'

const dirs: string[] = []
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs.length = 0 })

function freshApp() {
  const dir = mkdtempSync(join(tmpdir(), 'media-'))
  dirs.push(dir)
  const storage = createLocalStorage({ dir, baseUrl: 'http://localhost:4444/media' })
  return { app: createUploadApi({ storage, resolveActor: () => ({ id: 'local', role: 'owner' }) }), dir, storage }
}

describe('media upload e2e (real storage-local on disk)', () => {
  it('uploads to disk and serves the bytes back', async () => {
    const { app, dir } = freshApp()
    const body = new FormData()
    body.append('file', new File([new Uint8Array([9, 8, 7])], 'pic.webp', { type: 'image/webp' }))

    const up = await app.fetch(new Request('http://test/media', { method: 'POST', body }))
    expect(up.status).toBe(201)
    const { id, key, url } = (await up.json()) as { id: string; key: string; url: string }
    // id = YYYY/MM/slug
    expect(id).toMatch(/^\d{4}\/\d{2}\/pic$/)
    expect(key).toBe(`${id}.webp`)
    expect(url).toBe(`http://localhost:4444/media/${key}`)
    expect(existsSync(join(dir, key))).toBe(true)

    const served = await app.fetch(new Request(`http://test/media/${key}`))
    expect(served.status).toBe(200)
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]))
  })
})
