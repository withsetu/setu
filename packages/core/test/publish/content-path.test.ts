import { describe, it, expect } from 'vitest'
import { contentPath, parseContentPath } from '../../src/index'

describe('contentPath', () => {
  it('builds content/<collection>/<locale>/<slug>.mdoc', () => {
    expect(
      contentPath({ collection: 'post', locale: 'en', slug: 'hello' })
    ).toBe('content/post/en/hello.mdoc')
  })

  it('reflects locale and collection distinctly', () => {
    expect(
      contentPath({ collection: 'page', locale: 'fr', slug: 'about' })
    ).toBe('content/page/fr/about.mdoc')
  })
})

describe('parseContentPath', () => {
  it('parses a well-formed content path into an EntryRef', () => {
    expect(parseContentPath('content/post/en/hello.mdoc')).toEqual({
      collection: 'post',
      locale: 'en',
      slug: 'hello'
    })
  })

  it('round-trips with contentPath', () => {
    const ref = { collection: 'page', locale: 'fr', slug: 'a-propos' }
    expect(parseContentPath(contentPath(ref))).toEqual(ref)
  })

  it('returns null for non-content paths', () => {
    expect(parseContentPath('setu.config.ts')).toBeNull()
    expect(parseContentPath('content/post/en/hello.md')).toBeNull() // wrong extension
    expect(parseContentPath('content/post/hello.mdoc')).toBeNull() // missing locale segment
    expect(parseContentPath('content/post/en/sub/hello.mdoc')).toBeNull() // extra segment
    expect(parseContentPath('other/post/en/hello.mdoc')).toBeNull() // wrong root
  })
})

/** #670 — `contentPath` was pure interpolation while its inverse rejected `/` and empty
 *  segments, so the pair was not a bijection: a ref could mint a Git WRITE path that
 *  `parseContentPath` (and therefore the API's write gate, which classifies on it) would
 *  never recognise. Only one production caller validated its input; the rest
 *  (publish-service, bulk-service, taxonomy/delete-service, read-service, index-service)
 *  did not. Not currently exploitable — this closes the invariant. */
describe('contentPath rejects non-canonical segments (#670)', () => {
  const bad: [string, { collection: string; locale: string; slug: string }][] =
    [
      ['empty slug', { collection: 'post', locale: 'en', slug: '' }],
      ['empty collection', { collection: '', locale: 'en', slug: 'a' }],
      ['empty locale', { collection: 'post', locale: '', slug: 'a' }],
      ['slash in slug', { collection: 'post', locale: 'en', slug: 'a/b' }],
      ['slash in collection', { collection: 'a/b', locale: 'en', slug: 'x' }],
      ['traversal slug', { collection: 'post', locale: 'en', slug: '..' }],
      ['traversal locale', { collection: 'post', locale: '..', slug: 'a' }],
      ['dot segment', { collection: '.', locale: 'en', slug: 'a' }],
      ['backslash', { collection: 'post', locale: 'en', slug: 'a\\b' }],
      ['NUL byte', { collection: 'post', locale: 'en', slug: 'a\0b' }],
      ['newline', { collection: 'post', locale: 'en', slug: 'a\nb' }],
      ['leading space', { collection: 'post', locale: 'en', slug: ' a' }],
      ['trailing space', { collection: 'post', locale: 'en', slug: 'a ' }]
    ]
  for (const [name, ref] of bad) {
    it(`throws on ${name}`, () => {
      expect(() => contentPath(ref)).toThrow(/segment/i)
    })
  }

  it('accepts every segment the system legitimately mints, incl. non-ASCII slugs', () => {
    // entrySlugify keeps \p{L}, so "Über uns" mints "über-uns" — a real, valid identity.
    for (const slug of [
      'hello',
      'a-propos',
      'über-uns',
      'café',
      'a.b',
      '2026-recap'
    ])
      expect(() =>
        contentPath({ collection: 'post', locale: 'en', slug })
      ).not.toThrow()
  })

  it('is a true bijection with parseContentPath for accepted refs', () => {
    for (const ref of [
      { collection: 'post', locale: 'en', slug: 'hello' },
      { collection: 'page', locale: 'fr', slug: 'à-propos' },
      { collection: 'note', locale: 'de', slug: 'a.b' }
    ])
      expect(parseContentPath(contentPath(ref))).toEqual(ref)
  })
})
