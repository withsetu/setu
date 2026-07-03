import { describe, it, expect } from 'vitest'
import { toPermalinkEntry } from '../src/lib/permalinks'

describe('toPermalinkEntry', () => {
  it('projects id, ref parts, frontmatter date and categories', () => {
    const e = toPermalinkEntry({
      id: 'post/en/hello',
      data: { date: new Date(Date.UTC(2026, 5, 20)), categories: ['recipes'] }
    })
    expect(e).toEqual({
      id: 'post/en/hello', collection: 'post', locale: 'en', slug: 'hello',
      date: Date.UTC(2026, 5, 20), categories: ['recipes']
    })
  })
  it('accepts pubDate; NEVER uses updatedAt (URL stability)', () => {
    expect(toPermalinkEntry({ id: 'post/en/a', data: { pubDate: '2026-01-02' } }).date).toBe(Date.parse('2026-01-02'))
    expect(toPermalinkEntry({ id: 'post/en/b', data: { updatedAt: '2026-01-02' } }).date).toBeNull()
  })
  it('multi-segment slug survives', () => {
    expect(toPermalinkEntry({ id: 'page/en/docs/intro', data: {} }).slug).toBe('docs/intro')
  })
})
