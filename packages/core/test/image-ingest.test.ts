import { describe, it, expect } from 'vitest'
import type { GeneratedVariant, ImagePort, StoragePort, StoredObject, VariantSpec } from '../src/index'
import { ingestImage, extensionFor, contentTypeFor } from '../src/index'

function memStorage() {
  const map = new Map<string, StoredObject>()
  const port: StoragePort = {
    async put(key, body, opts) { map.set(key, { body: body.slice(), contentType: opts.contentType }) },
    async get(key) { const o = map.get(key); return o ? { body: o.body.slice(), contentType: o.contentType } : null },
    async delete(key) { map.delete(key) },
    async exists(key) { return map.has(key) },
    url(key) { return `/uploads/${key}` },
  }
  return { port, map }
}

/** Stub ImagePort: source is srcW×srcH; generate echoes each spec's width (height by aspect). */
function stubImage(srcW: number, srcH: number): ImagePort {
  return {
    async metadata() { return { width: srcW, height: srcH, format: 'png' } },
    async generate(_src, specs: VariantSpec[]): Promise<GeneratedVariant[]> {
      return specs.map((s) => ({
        name: s.name,
        width: s.width,
        height: Math.round((srcH * s.width) / srcW),
        format: s.format,
        contentType: `image/${s.format}`,
        body: new Uint8Array([s.width & 255]),
      }))
    },
  }
}

describe('format helpers', () => {
  it('extensionFor maps jpeg to jpg, others identity', () => {
    expect(extensionFor('jpeg')).toBe('jpg')
    expect(extensionFor('webp')).toBe('webp')
    expect(extensionFor('avif')).toBe('avif')
    expect(extensionFor('png')).toBe('png')
  })
  it('contentTypeFor builds image/<format>', () => {
    expect(contentTypeFor('jpeg')).toBe('image/jpeg')
    expect(contentTypeFor('webp')).toBe('image/webp')
  })
})

describe('ingestImage', () => {
  it('persists a deduped, no-upscale ladder + manifest and returns it', async () => {
    const { port, map } = memStorage()
    const manifest = await ingestImage(
      { image: stubImage(1000, 500), storage: port },
      { mediaKey: '2026/06/cat', bytes: new Uint8Array([1]), originalKey: '2026/06/cat.png', format: 'webp', widths: [400, 800, 1200, 1600] },
    )
    expect(manifest.id).toBe('2026/06/cat')
    // 1200 & 1600 exceed the 1000px source → dropped; source width 1000 added ⇒ [400, 800, 1000]
    expect(manifest.variants.map((v) => v.width)).toEqual([400, 800, 1000])
    expect(manifest.variants.map((v) => v.key)).toEqual([
      '2026/06/cat-400w.webp',
      '2026/06/cat-800w.webp',
      '2026/06/cat-1000w.webp',
    ])
    expect(manifest.original).toEqual({ key: '2026/06/cat.png', width: 1000, height: 500, format: 'png' })
    expect(manifest.format).toBe('webp')
    expect(map.get('2026/06/cat-400w.webp')?.contentType).toBe('image/webp')
    // manifest persisted at the sidecar key
    expect(map.has('2026/06/cat.manifest.json')).toBe(true)
    const mf = map.get('2026/06/cat.manifest.json')
    expect(mf?.contentType).toBe('application/json')
    expect(JSON.parse(new TextDecoder().decode(mf!.body)).id).toBe('2026/06/cat')
  })

  it('uses the .jpg extension for the jpeg format and never upscales', async () => {
    const { port } = memStorage()
    const manifest = await ingestImage(
      { image: stubImage(500, 500), storage: port },
      { mediaKey: '2026/06/photo', bytes: new Uint8Array([1]), originalKey: '2026/06/photo.jpg', format: 'jpeg', widths: [400, 800] },
    )
    // 800 > 500 source → dropped; 400 kept + source 500 ⇒ [400, 500]
    expect(manifest.variants.map((v) => v.key)).toEqual(['2026/06/photo-400w.jpg', '2026/06/photo-500w.jpg'])
  })
})
