import { describe, it, expect } from 'vitest'
import { contentPath, parseContentPath } from '../../src/index'

describe('contentPath', () => {
  it('builds content/<collection>/<locale>/<slug>.mdoc', () => {
    expect(contentPath({ collection: 'post', locale: 'en', slug: 'hello' })).toBe('content/post/en/hello.mdoc')
  })

  it('reflects locale and collection distinctly', () => {
    expect(contentPath({ collection: 'page', locale: 'fr', slug: 'about' })).toBe('content/page/fr/about.mdoc')
  })
})

describe('parseContentPath', () => {
  it('parses a well-formed content path into an EntryRef', () => {
    expect(parseContentPath('content/post/en/hello.mdoc')).toEqual({
      collection: 'post',
      locale: 'en',
      slug: 'hello',
    })
  })

  it('round-trips with contentPath', () => {
    const ref = { collection: 'page', locale: 'fr', slug: 'a-propos' }
    expect(parseContentPath(contentPath(ref))).toEqual(ref)
  })

  it('returns null for non-content paths', () => {
    expect(parseContentPath('saytu.config.ts')).toBeNull()
    expect(parseContentPath('content/post/en/hello.md')).toBeNull() // wrong extension
    expect(parseContentPath('content/post/hello.mdoc')).toBeNull() // missing locale segment
    expect(parseContentPath('content/post/en/sub/hello.mdoc')).toBeNull() // extra segment
    expect(parseContentPath('other/post/en/hello.mdoc')).toBeNull() // wrong root
  })
})
