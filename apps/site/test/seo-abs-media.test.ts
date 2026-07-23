import { describe, it, expect } from 'vitest'
import { absMedia } from '../src/lib/seo'

// #861 SEO-4: a protocol-relative `//host/x.jpg` failed the `^https?://` test but passed
// `startsWith('/')`, so it was treated as a local media path and prefixed with the media base —
// resolving the share image to the wrong origin when the media base is non-empty.
const BASE = new URL('https://example.com')
const MEDIA = 'https://cdn.example'

describe('absMedia (#861 SEO-4)', () => {
  it('treats a protocol-relative //host URL as already-absolute (no media-base prefix)', () => {
    expect(absMedia('//host/x.jpg', MEDIA, BASE)).toBe('https://host/x.jpg')
  })

  it('still prefixes a root-relative /media path with the media base', () => {
    expect(absMedia('/media/2026/06/cat.jpg', MEDIA, BASE)).toBe(
      'https://cdn.example/media/2026/06/cat.jpg'
    )
  })

  it('leaves an absolute http(s) URL untouched and returns undefined for empty', () => {
    expect(absMedia('https://elsewhere.example/x.jpg', MEDIA, BASE)).toBe(
      'https://elsewhere.example/x.jpg'
    )
    expect(absMedia('', MEDIA, BASE)).toBeUndefined()
  })
})
