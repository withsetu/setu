import { describe, expect, it } from 'vitest'
import { Markdoc } from '@astrojs/markdoc/config'
import {
  blockAttr,
  blockAttrErrors,
  blockTagValidate
} from '../markdoc-attr-validate.mjs'

// #1126: a schema violation inside a block attribute must name the block, the attribute and
// the expected values. These run REAL Markdoc validation over a config shaped exactly like the
// generated include (blockAttr per attribute, blockTagValidate per tag), so a regression to
// Markdoc's unnamed built-in messages — or to an empty reason list — fails here.
const config = {
  tags: {
    query: {
      attributes: {
        collection: blockAttr('query', 'collection', {
          type: 'String',
          matches: ['post', 'page', 'product'],
          ref: 'collection',
          default: 'post'
        }),
        sort: blockAttr('query', 'sort', {
          type: 'String',
          matches: ['newest', 'oldest', 'title'],
          default: 'newest'
        }),
        limit: blockAttr('query', 'limit', { type: 'Number', default: 10 }),
        showImage: blockAttr('query', 'showImage', {
          type: 'Boolean',
          default: true
        })
      },
      validate: blockTagValidate('query')
    }
  }
}

const messages = (src: string): string[] =>
  Markdoc.validate(Markdoc.parse(src), config)
    .filter((e) => e.error.level === 'error' || e.error.level === 'critical')
    .map((e) => e.error.message)

describe('named block-attribute validation (#1126)', () => {
  it('accepts valid attributes, including a declared non-built-in collection', () => {
    expect(
      messages(
        '{% query collection="product" sort="title" limit=6 showImage=false /%}'
      )
    ).toEqual([])
  })

  it('names the block, attribute and declared collections for an undeclared collection', () => {
    const [msg, ...rest] = messages('{% query collection="widgets" /%}')
    expect(rest).toEqual([])
    expect(msg).toContain('{% query %} attribute "collection"')
    expect(msg).toContain('"post", "page", "product"')
    expect(msg).toContain('got "widgets"')
    expect(msg).toContain('setu.config')
  })

  it('names the block, attribute and allowed values for a bad enum value', () => {
    expect(messages('{% query sort="random" /%}')).toEqual([
      '{% query %} attribute "sort" must be one of "newest", "oldest", "title" — got "random".'
    ])
  })

  it('names the block, attribute and expected type for a wrong-typed value', () => {
    expect(messages('{% query limit="six" /%}')).toEqual([
      '{% query %} attribute "limit" must be a number — got "six".'
    ])
    expect(messages('{% query showImage="no" /%}')).toEqual([
      '{% query %} attribute "showImage" must be true or false — got "no".'
    ])
  })

  it('names the block and lists what it accepts for an unknown attribute', () => {
    const msgs = messages('{% query count=3 /%}')
    expect(msgs).toContain(
      '{% query %} has no attribute "count". It accepts: collection, sort, limit, showImage.'
    )
  })

  it('never produces an empty message', () => {
    for (const src of [
      '{% query collection="x" /%}',
      '{% query sort=1 /%}',
      '{% query limit=[1] /%}',
      '{% query nope="x" /%}'
    ])
      for (const m of messages(src)) expect(m.trim().length).toBeGreaterThan(20)
  })

  it('leaves render-time variables alone', () => {
    expect(
      blockAttrErrors(
        'query',
        'limit',
        { type: 'Number' },
        { $$mdtype: 'Variable', path: ['n'] }
      )
    ).toEqual([])
  })

  it('keeps defaults on the schema so Markdoc still applies them', () => {
    expect(config.tags.query.attributes.collection.default).toBe('post')
  })
})
