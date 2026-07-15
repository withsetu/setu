import { describe, it, expect } from 'vitest'
import { resolvePermalink } from '../../src/permalinks/resolve'

const post = {
  collection: 'post',
  locale: 'en',
  slug: 'hello-world',
  date: Date.UTC(2026, 5, 20),
  categories: ['recipes']
}

describe('resolvePermalink', () => {
  it('substitutes all tokens', () => {
    expect(
      resolvePermalink(
        post,
        'blog/:year/:month/:day/:category/:collection/:slug'
      ).path
    ).toBe('blog/2026/06/20/recipes/post/hello-world')
  })
  it('reproduces the legacy scheme via the default pattern', () => {
    expect(resolvePermalink(post, ':collection/:slug').path).toBe(
      'post/hello-world'
    )
  })
  it('zero-pads month and day (UTC)', () => {
    const jan = { ...post, date: Date.UTC(2026, 0, 3) }
    expect(resolvePermalink(jan, ':year/:month/:day/:slug').path).toBe(
      '2026/01/03/hello-world'
    )
  })
  it('date token but no date → bare :slug + a warning', () => {
    const r = resolvePermalink({ ...post, date: null }, 'blog/:year/:slug')
    expect(r.path).toBe('hello-world')
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/no date/)
  })
  it(':category with no categories → uncategorized (default + configurable)', () => {
    expect(
      resolvePermalink({ ...post, categories: [] }, ':category/:slug').path
    ).toBe('uncategorized/hello-world')
    expect(
      resolvePermalink({ ...post, categories: [] }, ':category/:slug', {
        uncategorized: 'misc'
      }).path
    ).toBe('misc/hello-world')
  })
  it(':category uses the first category', () => {
    expect(
      resolvePermalink(
        { ...post, categories: ['recipes', 'life'] },
        ':category/:slug'
      ).path
    ).toBe('recipes/hello-world')
  })
  it(':category interpolates a valid slug category with no warning', () => {
    const r = resolvePermalink(
      { ...post, categories: ['news'] },
      ':category/:slug'
    )
    expect(r.path).toBe('news/hello-world')
    expect(r.warnings).toEqual([])
  })
  it(':category with a non-slug value (space/case) → uncategorized + warning', () => {
    const r = resolvePermalink(
      { ...post, categories: ['My Cat'] },
      ':category/:slug'
    )
    expect(r.path).toBe('uncategorized/hello-world')
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/My Cat/)
    expect(r.warnings[0]).toMatch(/uncategorized/)
  })
  it(':category with a path separator cannot inject URL segments', () => {
    const r = resolvePermalink(
      { ...post, categories: ['a/b'] },
      ':category/:slug'
    )
    expect(r.path).toBe('uncategorized/hello-world')
    expect(r.warnings).toHaveLength(1)
  })
  it(':category with a unicode value → uncategorized + warning', () => {
    const r = resolvePermalink(
      { ...post, categories: ['über'] },
      ':category/:slug'
    )
    expect(r.path).toBe('uncategorized/hello-world')
    expect(r.warnings).toHaveLength(1)
  })
  it(':category non-slug fallback honors the configured uncategorized slug', () => {
    const r = resolvePermalink(
      { ...post, categories: ['My Cat'] },
      ':category/:slug',
      { uncategorized: 'misc' }
    )
    expect(r.path).toBe('misc/hello-world')
    expect(r.warnings).toHaveLength(1)
  })
  it('non-default locale gets a leading prefix; default is unprefixed', () => {
    expect(
      resolvePermalink({ ...post, locale: 'fr' }, ':collection/:slug').path
    ).toBe('fr/post/hello-world')
    expect(resolvePermalink(post, ':collection/:slug').path).toBe(
      'post/hello-world'
    )
  })
  it('multi-segment slugs pass through', () => {
    expect(
      resolvePermalink({ ...post, slug: 'docs/intro' }, ':slug').path
    ).toBe('docs/intro')
  })
  it('warnings are empty on the happy path', () => {
    expect(resolvePermalink(post, ':collection/:slug').warnings).toEqual([])
  })
})
