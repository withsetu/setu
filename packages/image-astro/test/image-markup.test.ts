import { describe, it, expect } from 'vitest'
import type { MediaManifest } from '@setu/core'
import { imageMarkup } from '../src/lib/image-markup'

const resolveUrl = (s: string) => (/^https?:\/\//i.test(s) ? s : `http://cdn${s}`)
const manifest = (): MediaManifest => ({
  id: '2026/06/cat',
  format: 'webp',
  original: { key: '2026/06/cat.jpg', width: 1000, height: 600, format: 'jpeg' },
  variants: [
    { width: 400, height: 240, key: '2026/06/cat-400w.webp', contentType: 'image/webp' },
    { width: 800, height: 480, key: '2026/06/cat-800w.webp', contentType: 'image/webp' },
  ],
})

describe('imageMarkup', () => {
  it('builds srcset + intrinsic dims from a manifest', () => {
    const a = imageMarkup({
      manifest: manifest(),
      resolvedSrc: 'http://cdn/media/2026/06/cat.jpg',
      alt: 'cat',
      resolveUrl,
      sizes: '100vw',
    })
    expect(a.src).toBe('http://cdn/media/2026/06/cat.jpg')
    expect(a.srcset).toBe('http://cdn/media/2026/06/cat-400w.webp 400w, http://cdn/media/2026/06/cat-800w.webp 800w')
    expect(a.sizes).toBe('100vw')
    expect(a.width).toBe(1000)
    expect(a.height).toBe(600)
    expect(a.alt).toBe('cat')
  })

  it('falls back to a plain image when the manifest is null', () => {
    const a = imageMarkup({ manifest: null, resolvedSrc: 'https://x/p.png', alt: 'ext', resolveUrl, sizes: '100vw' })
    expect(a).toEqual({ src: 'https://x/p.png', alt: 'ext', title: undefined })
    expect(a.srcset).toBeUndefined()
  })

  it('treats an empty-variants manifest as no manifest', () => {
    const a = imageMarkup({ manifest: { ...manifest(), variants: [] }, resolvedSrc: 'http://cdn/x.png', alt: 'a', resolveUrl, sizes: '100vw' })
    expect(a.srcset).toBeUndefined()
    expect(a.width).toBeUndefined()
  })
})
