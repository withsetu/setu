import { describe, expect, it } from 'vitest'
import type { Category } from '@setu/core'
import { mergeCategoryNames } from '../../src/engine/categories'

const existing: Category[] = [
  { slug: 'recipes', name: 'Recipes', parent: null },
  { slug: 'prints', name: 'Prints and Drawings', parent: null }
]

describe('mergeCategoryNames', () => {
  it('reuses an existing category by case-insensitive name', () => {
    const merge = mergeCategoryNames(existing, ['prints AND drawings'])
    expect(merge.addedSlugs).toEqual([])
    expect(merge.cats).toEqual(existing)
    expect(merge.slugByName.get('prints and drawings')).toBe('prints')
  })

  it('appends new names via the core addCategory op, preserving existing entries', () => {
    const merge = mergeCategoryNames(existing, [
      'Painting and Sculpture',
      'Textiles'
    ])
    expect(merge.addedSlugs).toEqual(['painting-and-sculpture', 'textiles'])
    expect(merge.cats.slice(0, 2)).toEqual(existing)
    expect(merge.cats[2]).toEqual({
      slug: 'painting-and-sculpture',
      name: 'Painting and Sculpture',
      parent: null
    })
  })

  it('dedupes repeated names across the stream (they repeat per post)', () => {
    const merge = mergeCategoryNames([], ['Textiles', 'textiles', 'TEXTILES'])
    expect(merge.addedSlugs).toEqual(['textiles'])
    expect(merge.slugByName.get('textiles')).toBe('textiles')
  })

  it('suffixes a slug collision between distinct names (addCategory semantics)', () => {
    const merge = mergeCategoryNames(
      [{ slug: 'textiles', name: 'Fabric Arts', parent: null }],
      ['Textiles!']
    )
    // "Textiles!" is a new NAME whose slug collides — addCategory mints -2.
    expect(merge.addedSlugs).toEqual(['textiles-2'])
  })

  it('ignores empty and whitespace-only names', () => {
    const merge = mergeCategoryNames([], ['', '   '])
    expect(merge.addedSlugs).toEqual([])
    expect(merge.cats).toEqual([])
  })
})
