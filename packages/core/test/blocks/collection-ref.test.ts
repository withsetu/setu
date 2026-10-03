import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { collectionRef, isCollectionRef } from '../../src/blocks/collection-ref'
import { markdocAttributesFor } from '../../src/blocks/markdoc-attributes'
import { resolveControls } from '../../src/blocks/resolve-controls'
import { generateMarkdocTagsInclude } from '../../src/blocks/generate-markdoc'
import { buildRegistry } from '../../src/blocks/registry'
import { defineBlock } from '../../src/blocks/define-block'

const props = z.object({
  collection: collectionRef().default('post'),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.number().default(10)
})

describe('collectionRef (#1126)', () => {
  it('is a string at the zod layer — membership is checked against the resolved config', () => {
    expect(props.safeParse({ collection: 'product' }).success).toBe(true)
    expect(props.safeParse({ collection: '' }).success).toBe(false)
    expect(props.safeParse({ collection: 3 }).success).toBe(false)
  })

  it('survives .default()/.optional() and further zod chaining', () => {
    expect(isCollectionRef(collectionRef())).toBe(true)
    expect(isCollectionRef(collectionRef().max(40))).toBe(true)
    expect(isCollectionRef(z.string())).toBe(false)
  })

  it('maps to a String Markdoc attr carrying ref: collection', () => {
    expect(markdocAttributesFor(props).collection).toEqual({
      type: 'String',
      ref: 'collection',
      default: 'post',
      required: false
    })
  })

  it("derives the 'collection' picker control, and refuses other hints", () => {
    const [c] = resolveControls(props)
    expect(c).toMatchObject({ name: 'collection', control: 'collection' })
    expect(() => resolveControls(props, { collection: 'text' })).toThrow(
      /incompatible/
    )
    // …and a plain string cannot pretend to be a collection reference: the build would
    // never check membership, so the picker would be a lie.
    expect(() =>
      resolveControls(z.object({ s: z.string() }), { s: 'collection' })
    ).toThrow(/incompatible/)
  })
})

describe('generateMarkdocTagsInclude — collection refs + named validation (#1126)', () => {
  const registry = buildRegistry([
    {
      tag: 'query',
      component: 'blocks/query/query.astro',
      contract: defineBlock({ props })
    }
  ])

  it('resolves a collection ref against the declared collections', () => {
    const src = generateMarkdocTagsInclude(registry, {
      collections: ['post', 'page', 'product']
    })
    expect(src).toContain(
      `collection: blockAttr('query', 'collection', { type: "String", matches: ["post","page","product"], ref: "collection", default: "post" })`
    )
    // Plain enums keep their own value set; every tag gets the named unknown-attr check.
    expect(src).toContain(`matches: ["newest","oldest"]`)
    expect(src).toContain(`validate: blockTagValidate('query')`)
    expect(src).toContain(
      `import { blockAttr, blockTagValidate } from './markdoc-attr-validate.mjs'`
    )
  })

  it('refuses to emit a collection ref without the declared set (never silently lossy)', () => {
    expect(() => generateMarkdocTagsInclude(registry)).toThrow(
      /declared collections/
    )
  })
})
