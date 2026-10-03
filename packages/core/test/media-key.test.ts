import { describe, it, expect } from 'vitest'
import {
  mediaSlug,
  mediaKeyOf,
  originalKey,
  variantKey,
  manifestKey,
  mediaRecordKey
} from '../src/index'

describe('mediaSlug', () => {
  it('lowercases, strips the extension, and dash-joins words', () => {
    expect(mediaSlug('My Cat Photo.JPG')).toBe('my-cat-photo')
  })
  it('collapses punctuation/unicode and trims dashes', () => {
    expect(mediaSlug('  Héllo — Wörld!!.png')).toBe('hello-world')
  })
  it('falls back to "file" for an empty/exotic name', () => {
    expect(mediaSlug('©.png')).toBe('file')
    expect(mediaSlug('.gitignore')).toBe('file')
  })
  it('caps very long slugs at 60 chars (no trailing dash)', () => {
    const s = mediaSlug('a'.repeat(200) + '.jpg')
    expect(s.length).toBeLessThanOrEqual(60)
    expect(s.endsWith('-')).toBe(false)
  })
  it('keeps an extensionless filename', () => {
    expect(mediaSlug('Makefile')).toBe('makefile')
    expect(mediaSlug('README')).toBe('readme')
  })
})

describe('key assembly', () => {
  it('mediaKeyOf zero-pads the month', () => {
    expect(mediaKeyOf(2026, 6, 'my-cat-photo')).toBe('2026/06/my-cat-photo')
    expect(mediaKeyOf(2026, 12, 'x')).toBe('2026/12/x')
  })
  it('builds original/variant/manifest keys', () => {
    const k = '2026/06/my-cat-photo'
    expect(originalKey(k, 'jpg')).toBe('2026/06/my-cat-photo.jpg')
    expect(variantKey(k, 800, 'webp')).toBe('2026/06/my-cat-photo.800w.webp')
    expect(manifestKey(k)).toBe('2026/06/my-cat-photo.manifest.json')
  })
})

// #1159: an upload's id is probed only against keys an id can OWN (original, manifest, record).
// That probe is sufficient only because variant keys live in a namespace no other id's keys can
// reach — this suite is the test media-key.ts's invariant comment names.
describe('key namespaces are disjoint across ids (#1159)', () => {
  const exts = ['jpg', 'png', 'webp', 'gif', 'avif', 'pdf', 'docx', 'md', 'mp4']
  const widths = [400, 800, 1000, 1200, 1600]
  // Slugs chosen to look like each other's variants under the legacy `-<w>w` scheme.
  const slugs = [
    'cat',
    'cat-400w',
    'cat-800w',
    'cat-2',
    'cat-400w-2',
    'manifest',
    'media',
    'file'
  ]
  const ids = slugs.map((s) => mediaKeyOf(2026, 6, s))
  const keysOf = (id: string) => [
    ...exts.map((e) => originalKey(id, e)),
    manifestKey(id),
    mediaRecordKey(id),
    ...widths.flatMap((w) => exts.map((e) => variantKey(id, w, e)))
  ]

  it('no key written for one id equals any key written for a different id', () => {
    const owner = new Map<string, string>()
    for (const id of ids)
      for (const k of keysOf(id)) {
        const prev = owner.get(k)
        if (prev !== undefined) expect(prev).toBe(id)
        owner.set(k, id)
      }
  })

  it('within one id, a variant never equals the original, manifest or record key', () => {
    for (const id of ids) {
      const ks = keysOf(id)
      expect(new Set(ks).size).toBe(ks.length)
    }
  })

  it("a legacy `-<w>w` variant key is still only reachable as another id's original", () => {
    // Pre-#1159 media keep `<id>-<w>w.<ext>` variant keys in their manifests. Such a key can
    // equal originalKey('<id>-<w>w', ext) — which is why the upload probe checks the original key.
    expect(originalKey(mediaKeyOf(2026, 6, 'cat-400w'), 'webp')).toBe(
      '2026/06/cat-400w.webp'
    )
    expect(variantKey(mediaKeyOf(2026, 6, 'cat'), 400, 'webp')).not.toBe(
      '2026/06/cat-400w.webp'
    )
  })
})
