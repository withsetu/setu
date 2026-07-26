import { describe, it, expect } from 'vitest'
import {
  BUILT_IN_COLLECTIONS,
  collectionHasTaxonomy,
  dynamicCollections,
  findCollection,
  pathForCollection
} from '../src/data/collections'
import type { CollectionDescriptor } from '../src/data/collections'

const product: CollectionDescriptor = {
  name: 'product',
  label: 'Product',
  labelPlural: 'Products',
  taxonomies: ['category']
}
const all = [...BUILT_IN_COLLECTIONS, product]

describe('pathForCollection', () => {
  it.each([
    ['post', '/posts'],
    ['page', '/pages']
  ])('keeps the pre-existing route for %s', (name, path) => {
    expect(pathForCollection(name)).toBe(path)
  })

  it('routes a declared collection under /content', () => {
    expect(pathForCollection('product')).toBe('/content/product')
  })
})

describe('dynamicCollections', () => {
  it('excludes the collections that already have hand-written routes', () => {
    expect(dynamicCollections(all).map((c) => c.name)).toEqual(['product'])
  })

  it('is empty for a site that declares nothing extra', () => {
    expect(dynamicCollections(BUILT_IN_COLLECTIONS)).toEqual([])
  })
})

describe('findCollection', () => {
  it('finds a declared collection by name', () => {
    expect(findCollection(all, 'product')?.labelPlural).toBe('Products')
  })

  it('returns undefined for an unknown name or no name', () => {
    expect(findCollection(all, 'widget')).toBeUndefined()
    expect(findCollection(all, undefined)).toBeUndefined()
  })
})

describe('collectionHasTaxonomy', () => {
  it('reports the built-in post/page split', () => {
    expect(collectionHasTaxonomy(all, 'post', 'category')).toBe(true)
    expect(collectionHasTaxonomy(all, 'post', 'tag')).toBe(true)
    expect(collectionHasTaxonomy(all, 'page', 'category')).toBe(false)
  })

  it('reads a declared collection s own taxonomy list', () => {
    expect(collectionHasTaxonomy(all, 'product', 'category')).toBe(true)
    expect(collectionHasTaxonomy(all, 'product', 'tag')).toBe(false)
  })

  // Fail closed: offering a taxonomy field for a type that never declared it would write
  // frontmatter no renderer reads.
  it('reports nothing for an unknown collection', () => {
    expect(collectionHasTaxonomy(all, 'widget', 'category')).toBe(false)
    expect(collectionHasTaxonomy(all, 'widget', 'tag')).toBe(false)
  })
})
