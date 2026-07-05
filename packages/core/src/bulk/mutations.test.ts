import { describe, expect, it } from 'vitest'
import { addCategory, removeCategory, addTag, removeTag } from './mutations'

describe('bulk metadata mutations', () => {
  it('addCategory appends a slug, deduped; absent/non-array → []', () => {
    expect(addCategory({}, 'react')).toEqual({ categories: ['react'] })
    expect(addCategory({ categories: ['react'] }, 'vue')).toEqual({
      categories: ['react', 'vue']
    })
    expect(addCategory({ categories: ['react'] }, 'react')).toEqual({
      categories: ['react']
    })
  })
  it('addCategory returns the SAME object when already present (no-op)', () => {
    const m = { categories: ['react'] }
    expect(addCategory(m, 'react')).toBe(m)
  })
  it('removeCategory drops a slug; no-op when absent', () => {
    expect(removeCategory({ categories: ['react', 'vue'] }, 'react')).toEqual({
      categories: ['vue']
    })
    const m = { categories: ['vue'] }
    expect(removeCategory(m, 'react')).toBe(m)
  })
  it('addTag normalizes then appends, deduped; empty after normalize → no-op', () => {
    expect(addTag({}, 'React Native')).toEqual({ tags: ['react-native'] })
    const m = { tags: ['react'] }
    expect(addTag(m, 'React')).toBe(m)
    expect(addTag(m, '!!!')).toBe(m)
  })
  it('removeTag normalizes then drops; no-op when absent', () => {
    expect(removeTag({ tags: ['react', 'vue'] }, 'React')).toEqual({
      tags: ['vue']
    })
    const m = { tags: ['vue'] }
    expect(removeTag(m, 'react')).toBe(m)
  })
  it('preserves other metadata keys', () => {
    expect(addCategory({ title: 'X', categories: [] }, 'a')).toEqual({
      title: 'X',
      categories: ['a']
    })
  })
})
