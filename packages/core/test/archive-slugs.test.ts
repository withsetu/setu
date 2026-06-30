import { describe, it, expect } from 'vitest'
import { distinctCategorySlugs, distinctTagSlugs, categoryNameMap } from '../src/posts/archive-slugs'
import type { PostRow } from '../src/posts/select-posts'
import type { Category } from '../src/taxonomy/types'

const row = (over: Partial<PostRow>): PostRow => ({
  id: 'post/en/x', collection: 'post', locale: 'en', slug: 'x',
  title: 'X', date: 0, tags: [], categories: [], ...over,
})

describe('distinctCategorySlugs', () => {
  it('dedupes + sorts category slugs for the locale, ignoring other collections/locales', () => {
    const rows = [
      row({ id: 'post/en/a', slug: 'a', categories: ['recipes', 'dinner'] }),
      row({ id: 'post/en/b', slug: 'b', categories: ['recipes'] }),
      row({ id: 'post/fr/c', slug: 'c', locale: 'fr', categories: ['soupe'] }),
      row({ id: 'page/en/p', slug: 'p', collection: 'page', categories: ['ignored'] }),
    ]
    expect(distinctCategorySlugs(rows, 'en')).toEqual(['dinner', 'recipes'])
  })
  it('returns [] when nothing matches', () => {
    expect(distinctCategorySlugs([], 'en')).toEqual([])
  })
})

describe('distinctTagSlugs', () => {
  it('dedupes + sorts tags for the locale', () => {
    const rows = [
      row({ id: 'post/en/a', slug: 'a', tags: ['astro', 'cms'] }),
      row({ id: 'post/en/b', slug: 'b', tags: ['astro'] }),
    ]
    expect(distinctTagSlugs(rows, 'en')).toEqual(['astro', 'cms'])
  })
})

describe('categoryNameMap', () => {
  it('maps slug → name', () => {
    const cats: Category[] = [
      { slug: 'recipes', name: 'Recipes', parent: null },
      { slug: 'dinner', name: 'Dinner Ideas', parent: 'recipes' },
    ]
    const m = categoryNameMap(cats)
    expect(m.get('recipes')).toBe('Recipes')
    expect(m.get('dinner')).toBe('Dinner Ideas')
    expect(m.get('missing')).toBeUndefined()
  })
})
