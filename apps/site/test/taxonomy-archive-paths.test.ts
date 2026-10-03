import { describe, expect, it } from 'vitest'
import type { PostRow } from '@setu/core'
import { taxonomyArchiveGroups } from '../src/lib/taxonomy-archive'

const row = (
  locale: string,
  slug: string,
  over: Partial<PostRow> = {}
): PostRow => ({
  id: `post/${locale}/${slug}`,
  collection: 'post',
  locale,
  slug,
  title: slug,
  date: null,
  tags: [],
  categories: [],
  ...over
})

const rows: PostRow[] = [
  row('en', 'a', { tags: ['astro'], date: 1 }),
  row('en', 'b', { tags: ['astro'], date: 2 }),
  row('fr', 'a', { tags: ['astro', 'voyage'], categories: ['recipes'] }),
  row('fr', 'hidden', { tags: ['secret'], published: false }),
  row('de', 'x', { tags: ['astro'] }),
  { ...row('en', 'p', { tags: ['astro'] }), collection: 'page' }
]

describe('taxonomyArchiveGroups (#1114)', () => {
  it("'default' scope = only the default locale's terms, newest first (unchanged behaviour)", () => {
    const g = taxonomyArchiveGroups(rows, 'tag', 'default')
    expect(g.map((x) => [x.locale, x.slug])).toEqual([['en', 'astro']])
    expect(g[0].posts.map((p) => p.id)).toEqual(['post/en/b', 'post/en/a'])
  })

  it("'localized' scope = one group per (non-default locale, term with ≥1 post there)", () => {
    const g = taxonomyArchiveGroups(rows, 'tag', 'localized')
    expect(g.map((x) => [x.locale, x.slug])).toEqual([
      ['de', 'astro'],
      ['fr', 'astro'],
      ['fr', 'voyage']
    ])
    // Only that locale's posts; unpublished never forms a group.
    expect(
      g
        .find((x) => x.locale === 'fr' && x.slug === 'astro')!
        .posts.map((p) => p.id)
    ).toEqual(['post/fr/a'])
    expect(g.some((x) => x.slug === 'secret')).toBe(false)
  })

  it('hreflang alternates link only the locale variants of the same term that exist', () => {
    const fr = taxonomyArchiveGroups(rows, 'tag', 'localized')
    const astro = fr.find((x) => x.locale === 'fr' && x.slug === 'astro')!
    expect(astro.alternates).toEqual([
      { locale: 'en', path: '/tag/astro' },
      { locale: 'de', path: '/de/tag/astro' },
      { locale: 'fr', path: '/fr/tag/astro' }
    ])
    // A fr-only term has no translation cluster → no alternates.
    expect(fr.find((x) => x.slug === 'voyage')!.alternates).toEqual([])
    const en = taxonomyArchiveGroups(rows, 'tag', 'default')[0]
    expect(en.alternates.map((a) => a.locale)).toEqual(['en', 'de', 'fr'])
  })

  it('categories bucket the same way', () => {
    expect(
      taxonomyArchiveGroups(rows, 'category', 'localized').map((x) => [
        x.locale,
        x.slug
      ])
    ).toEqual([['fr', 'recipes']])
    expect(taxonomyArchiveGroups(rows, 'category', 'default')).toEqual([])
  })
})
