import { describe, expect, it } from 'vitest'
import { parseMdoc, serializeMdoc } from '@setu/core'
import { buildPostFrontmatter } from '../../src/engine/frontmatter'

const base = {
  cid: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  title: 'Water Lilies',
  date: '1906-01-01T00:00:00.000Z',
  draft: false,
  categories: ['painting-and-sculpture'],
  tags: ['oil-paint', 'canvas'],
  authorEmail: 'demo-author-1@demo.setu.test'
}

describe('buildPostFrontmatter', () => {
  it('emits the product-read keys plus the forward-compatible author', () => {
    expect(
      buildPostFrontmatter({
        ...base,
        featuredImage: '/media/1906/01/water-lilies.jpg'
      })
    ).toEqual({
      cid: base.cid,
      title: 'Water Lilies',
      date: '1906-01-01T00:00:00.000Z',
      categories: ['painting-and-sculpture'],
      tags: ['oil-paint', 'canvas'],
      featuredImage: '/media/1906/01/water-lilies.jpg',
      author: 'demo-author-1@demo.setu.test'
    })
  })

  it('marks drafts with published: false — and ONLY drafts (no status field ever)', () => {
    const draft = buildPostFrontmatter({ ...base, draft: true })
    expect(draft['published']).toBe(false)
    expect('status' in draft).toBe(false)
    const live = buildPostFrontmatter(base)
    expect('published' in live).toBe(false)
  })

  it('omits empty lists and an absent featured image entirely', () => {
    const fm = buildPostFrontmatter({
      ...base,
      categories: [],
      tags: []
    })
    expect('categories' in fm).toBe(false)
    expect('tags' in fm).toBe(false)
    expect('featuredImage' in fm).toBe(false)
  })

  it('round-trips through serializeMdoc/parseMdoc byte-stably', () => {
    const frontmatter = buildPostFrontmatter({
      ...base,
      draft: true,
      featuredImage: '/media/1906/01/water-lilies.jpg'
    })
    const body = 'A body.\n'
    const raw = serializeMdoc({ frontmatter, body })
    const parsed = parseMdoc(raw)
    expect(parsed.frontmatter).toEqual(frontmatter)
    expect(parsed.body).toBe(body)
    expect(serializeMdoc(parsed)).toBe(raw)
  })
})
