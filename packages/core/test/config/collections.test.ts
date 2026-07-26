import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { resolveConfig, validateEntryMetadata } from '../../src/index'

const product = () => ({
  name: 'product',
  label: 'Product',
  labelPlural: 'Products',
  fields: z.object({
    sku: z.string(),
    stock: z.enum(['in', 'out']).default('in')
  })
})

describe('resolveConfig — collections', () => {
  it('ships page and post as declared defaults when the author declares none', () => {
    const resolved = resolveConfig({})
    expect([...resolved.collectionsByName.keys()].sort()).toEqual([
      'page',
      'post'
    ])
    expect(resolved.collectionsByName.get('post')?.labelPlural).toBe('Posts')
  })

  it('indexes a declared collection alongside the defaults', () => {
    const resolved = resolveConfig({ collections: [product()] })
    expect([...resolved.collectionsByName.keys()].sort()).toEqual([
      'page',
      'post',
      'product'
    ])
    expect(resolved.collections.map((c) => c.name)).toContain('product')
    expect(resolved.collectionsByName.get('product')?.label).toBe('Product')
  })

  it('lets a declared collection override a default of the same name', () => {
    const resolved = resolveConfig({
      collections: [{ name: 'post', labelPlural: 'Articles' }]
    })
    expect(resolved.collectionsByName.size).toBe(2)
    expect(resolved.collectionsByName.get('post')?.labelPlural).toBe('Articles')
  })

  it('derives labels from the name when the author omits them', () => {
    const resolved = resolveConfig({ collections: [{ name: 'case-study' }] })
    const c = resolved.collectionsByName.get('case-study')
    expect(c?.label).toBe('Case Study')
    expect(c?.labelPlural).toBe('Case Studies')
  })

  it('throws on a duplicate collection name', () => {
    expect(() =>
      resolveConfig({
        collections: [{ name: 'product' }, { name: 'product' }]
      })
    ).toThrow(/duplicate collection/i)
  })

  // A collection name is interpolated into a Git write path by contentPath (#670),
  // so it must survive the same canonical-segment guard the path layer applies.
  it.each([
    ['a slash', 'docs/guides'],
    ['a backslash', 'docs\\guides'],
    ['a dot segment', '..'],
    ['a single dot', '.'],
    ['an empty string', ''],
    ['untrimmed whitespace', ' product '],
    ['a NUL byte', 'prod\u0000uct'],
    ['a C0 control character', 'prod\u001Fuct']
  ])('throws when a collection name contains %s', (_label, name) => {
    expect(() => resolveConfig({ collections: [{ name }] })).toThrow(
      /canonical path segment/i
    )
  })

  it.each(['category', 'tag'])(
    'throws on the reserved collection name %s',
    (name) => {
      expect(() => resolveConfig({ collections: [{ name }] })).toThrow(
        /reserved/i
      )
    }
  )

  it('throws when fields is not a Zod object schema', () => {
    expect(() =>
      resolveConfig({
        collections: [{ name: 'product', fields: { sku: 'string' } }]
      })
    ).toThrow(/zod object schema/i)
  })

  it('throws when fields is a non-object Zod schema', () => {
    expect(() =>
      resolveConfig({ collections: [{ name: 'product', fields: z.string() }] })
    ).toThrow(/zod object schema/i)
  })

  it('carries taxonomies as declared data', () => {
    const resolved = resolveConfig({
      collections: [{ name: 'product', taxonomies: ['category'] }]
    })
    expect(resolved.collectionsByName.get('product')?.taxonomies).toEqual([
      'category'
    ])
  })

  it('leaves blocks resolution untouched', () => {
    const resolved = resolveConfig({
      blocks: [
        { tag: 'callout', props: z.object({}), component: './callout.astro' }
      ],
      collections: [product()]
    })
    expect([...resolved.knownBlockTags]).toEqual(['callout'])
  })
})

describe('validateEntryMetadata', () => {
  const config = resolveConfig({ collections: [product()] })

  it('accepts metadata satisfying the declared fields', () => {
    const result = validateEntryMetadata(config, 'product', {
      title: 'Polygrout',
      sku: 'PG-100'
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value['sku']).toBe('PG-100')
  })

  it('applies a declared default for an absent field', () => {
    const result = validateEntryMetadata(config, 'product', {
      title: 'Polygrout',
      sku: 'PG-100'
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value['stock']).toBe('in')
  })

  it('reports a per-field error with the field path', () => {
    const result = validateEntryMetadata(config, 'product', {
      title: 'Polygrout',
      stock: 'maybe'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((e) => e.path).sort()).toEqual(['sku', 'stock'])
      expect(result.errors.find((e) => e.path === 'sku')?.message).toMatch(
        /required/i
      )
    }
  })

  // Existing content carries hand-authored keys the schema never declares
  // (`pubDate`, theme-specific keys). Validation must not delete them.
  it('preserves undeclared frontmatter keys', () => {
    const result = validateEntryMetadata(config, 'product', {
      title: 'Polygrout',
      sku: 'PG-100',
      pubDate: '2026-01-01'
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value['pubDate']).toBe('2026-01-01')
  })

  it('accepts the base fields on a collection that declares no custom fields', () => {
    const result = validateEntryMetadata(config, 'page', {
      title: 'About',
      published: false,
      featuredImage: '/media/2026/07/a.webp'
    })
    expect(result.ok).toBe(true)
  })

  it('reports a base field whose type is wrong', () => {
    const result = validateEntryMetadata(config, 'page', {
      title: 'About',
      published: 'yes'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.path).toBe('published')
  })

  it('fails closed for an undeclared collection', () => {
    const result = validateEntryMetadata(config, 'widget', { title: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/unknown/i)
  })

  it('fails closed for metadata that is not an object', () => {
    const result = validateEntryMetadata(config, 'product', 'nope')
    expect(result.ok).toBe(false)
  })
})
