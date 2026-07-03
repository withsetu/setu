import { describe, it, expect } from 'vitest'
import type { MediaManifest } from '../src/image/manifest'

describe('MediaManifest shape', () => {
  it('allows per-variant format and an optional lqip data-URI', () => {
    const m: MediaManifest = {
      id: '2026/06/cat',
      format: 'webp',
      original: {
        key: '2026/06/cat.png',
        width: 1600,
        height: 900,
        format: 'png'
      },
      variants: [
        {
          width: 800,
          height: 450,
          key: '2026/06/cat-w800.webp',
          contentType: 'image/webp',
          format: 'webp'
        },
        {
          width: 800,
          height: 450,
          key: '2026/06/cat-w800.avif',
          contentType: 'image/avif',
          format: 'avif'
        }
      ],
      lqip: 'data:image/webp;base64,AAAA'
    }
    expect(m.variants[1]!.format).toBe('avif')
    expect(m.lqip).toMatch(/^data:image\/webp;base64,/)
  })

  it('back-compat: a variant without format and no lqip is still valid', () => {
    const m: MediaManifest = {
      id: 'x',
      format: 'webp',
      original: { key: 'x.png', width: 10, height: 10, format: 'png' },
      variants: [
        { width: 10, height: 10, key: 'x-w10.webp', contentType: 'image/webp' }
      ]
    }
    expect(m.variants[0]!.format).toBeUndefined()
    expect(m.lqip).toBeUndefined()
  })
})
