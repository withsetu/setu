import { describe, expect, it } from 'vitest'
import { parseCategories, serializeCategories } from './parse'
import type { Category } from './types'

describe('parseCategories', () => {
  it('returns [] for empty or whitespace input', () => {
    expect(parseCategories('')).toEqual([])
    expect(parseCategories('   \n')).toEqual([])
  })

  it('parses a flat list with parent refs', () => {
    const yaml = '- slug: tutorials\n  name: Tutorials\n  parent: null\n- slug: react\n  name: React\n  parent: tutorials\n'
    expect(parseCategories(yaml)).toEqual([
      { slug: 'tutorials', name: 'Tutorials', parent: null },
      { slug: 'react', name: 'React', parent: 'tutorials' },
    ])
  })

  it('defaults a missing parent to null and skips malformed rows', () => {
    expect(parseCategories('- slug: a\n  name: A\n- name: nope\n')).toEqual([
      { slug: 'a', name: 'A', parent: null },
    ])
  })

  it('returns [] on non-list / malformed YAML rather than throwing', () => {
    expect(parseCategories('not: a list')).toEqual([])
    expect(parseCategories('::: broken')).toEqual([])
  })
})

describe('serializeCategories', () => {
  it('round-trips through parseCategories', () => {
    const cats: Category[] = [
      { slug: 'tutorials', name: 'Tutorials', parent: null },
      { slug: 'react', name: 'React', parent: 'tutorials' },
    ]
    expect(parseCategories(serializeCategories(cats))).toEqual(cats)
  })

  it('serializes an empty list to empty string', () => {
    expect(serializeCategories([])).toBe('')
  })
})
