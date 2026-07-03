import { describe, expect, it } from 'vitest'
import {
  addCategory,
  removeCategory,
  renameLabel,
  reparent,
  slugify,
  TaxonomyError
} from './ops'
import type { Category } from './types'

const cat = (slug: string, parent: string | null = null): Category => ({
  slug,
  name: slug,
  parent
})

describe('slugify', () => {
  it('lowercases, hyphenates, drops punctuation', () => {
    expect(slugify('  React Native! ')).toBe('react-native')
  })
  it('falls back to "category" for empty/symbol-only', () => {
    expect(slugify('!!!')).toBe('category')
  })
})

describe('addCategory', () => {
  it('adds a root category, slugified', () => {
    const { cats, slug } = addCategory([], { name: 'Tutorials', parent: null })
    expect(slug).toBe('tutorials')
    expect(cats).toEqual([
      { slug: 'tutorials', name: 'Tutorials', parent: null }
    ])
  })
  it('de-duplicates slugs with a numeric suffix', () => {
    const { slug } = addCategory([cat('react')], {
      name: 'React',
      parent: null
    })
    expect(slug).toBe('react-2')
  })
  it('throws when parent does not exist', () => {
    expect(() => addCategory([], { name: 'X', parent: 'ghost' })).toThrow(
      TaxonomyError
    )
  })
  it('trims the display name', () => {
    const { cats } = addCategory([], { name: '  Spaced  ', parent: null })
    expect(cats[0]!.name).toBe('Spaced')
  })
  it('throws empty-name when name is all whitespace', () => {
    const err = (() => {
      try {
        addCategory([], { name: '   ', parent: null })
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(TaxonomyError)
    expect((err as TaxonomyError).code).toBe('empty-name')
  })
})

describe('renameLabel', () => {
  it('changes only the name', () => {
    expect(renameLabel([cat('a')], 'a', 'Alpha')).toEqual([
      { slug: 'a', name: 'Alpha', parent: null }
    ])
  })
  it('throws when slug missing', () => {
    expect(() => renameLabel([], 'a', 'Alpha')).toThrow(TaxonomyError)
  })
  it('throws empty-name when new name is all whitespace', () => {
    const err = (() => {
      try {
        renameLabel([cat('a')], 'a', '  ')
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(TaxonomyError)
    expect((err as TaxonomyError).code).toBe('empty-name')
  })
})

describe('reparent', () => {
  it('moves a category under a new parent', () => {
    expect(reparent([cat('a'), cat('b')], 'b', 'a')).toEqual([
      { slug: 'a', name: 'a', parent: null },
      { slug: 'b', name: 'b', parent: 'a' }
    ])
  })
  it('moves a category to root', () => {
    expect(reparent([cat('a'), cat('b', 'a')], 'b', null)[1]!.parent).toBeNull()
  })
  it('throws on self-parent', () => {
    expect(() => reparent([cat('a')], 'a', 'a')).toThrow(TaxonomyError)
  })
  it('throws when the move would create a cycle', () => {
    // a -> b -> c; reparenting a under c loops
    const cats = [cat('a'), cat('b', 'a'), cat('c', 'b')]
    expect(() => reparent(cats, 'a', 'c')).toThrow(TaxonomyError)
  })
  it('throws when parent does not exist', () => {
    expect(() => reparent([cat('a')], 'a', 'ghost')).toThrow(TaxonomyError)
  })
})

describe('removeCategory', () => {
  const base = [
    { slug: 'eng', name: 'Engineering', parent: null },
    { slug: 'frontend', name: 'Frontend', parent: 'eng' },
    { slug: 'react', name: 'React', parent: 'frontend' },
    { slug: 'news', name: 'News', parent: null }
  ]
  it('removes the node and promotes its direct children to the removed node parent', () => {
    const next = removeCategory(base, 'eng')
    expect(next.find((c) => c.slug === 'eng')).toBeUndefined()
    expect(next.find((c) => c.slug === 'frontend')!.parent).toBeNull()
    // grandchild untouched — still points at its own (surviving) parent
    expect(next.find((c) => c.slug === 'react')!.parent).toBe('frontend')
  })
  it('promotes a mid-tree node children up one level', () => {
    const next = removeCategory(base, 'frontend')
    expect(next.find((c) => c.slug === 'frontend')).toBeUndefined()
    expect(next.find((c) => c.slug === 'react')!.parent).toBe('eng')
  })
  it('removes a leaf with no children', () => {
    expect(removeCategory(base, 'news').map((c) => c.slug)).toEqual([
      'eng',
      'frontend',
      'react'
    ])
  })
  it('throws not-found for a missing slug', () => {
    expect(() => removeCategory(base, 'nope')).toThrow('does not exist')
  })
})
