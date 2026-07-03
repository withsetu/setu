import { describe, it, expect } from 'vitest'
import { parsePageSeoOverride } from '../../src/seo/page-override'

describe('parsePageSeoOverride', () => {
  it('reads the frontmatter seo block', () => {
    const ov = parsePageSeoOverride({
      title: 'Doc Title',
      seo: {
        title: 'Custom SEO Title',
        description: 'Custom desc',
        image: '/media/2026/06/x.jpg',
        canonical: 'https://example.com/canonical',
        noindex: true
      }
    })
    expect(ov).toEqual({
      title: 'Custom SEO Title',
      description: 'Custom desc',
      image: '/media/2026/06/x.jpg',
      canonical: 'https://example.com/canonical',
      noindex: true
    })
  })

  it('returns an empty override when seo is absent, wrong-typed, or empty strings', () => {
    expect(parsePageSeoOverride({ title: 'x' })).toEqual({})
    expect(parsePageSeoOverride({ seo: 'nope' })).toEqual({})
    expect(parsePageSeoOverride(null)).toEqual({})
    expect(
      parsePageSeoOverride({ seo: { title: '   ', description: '' } })
    ).toEqual({})
  })

  it('only sets noindex when it is exactly true (not truthy strings)', () => {
    expect(
      parsePageSeoOverride({ seo: { noindex: 'true' } }).noindex
    ).toBeUndefined()
    expect(
      parsePageSeoOverride({ seo: { noindex: false } }).noindex
    ).toBeUndefined()
    expect(parsePageSeoOverride({ seo: { noindex: true } }).noindex).toBe(true)
  })
})
