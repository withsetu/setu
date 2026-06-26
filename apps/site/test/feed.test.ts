import { describe, it, expect } from 'vitest'
import { excerpt, selectFeedPosts, toFeedItem, type FeedRow } from '../src/lib/feed'

const row = (id: string, date: string, data: Record<string, unknown> = {}, body = ''): FeedRow =>
  ({ id, data: { title: 'T', ...data }, body, date: new Date(date) })

describe('excerpt', () => {
  it('strips markdoc tags + truncates on a word boundary', () => {
    const out = excerpt('{% callout %}Hello{% /callout %} ' + 'word '.repeat(80))
    expect(out).not.toContain('{%')
    expect(out.length).toBeLessThanOrEqual(201)
    expect(out.endsWith('…')).toBe(true)
  })
  it('leaves short text unchanged (no ellipsis)', () => {
    expect(excerpt('Just a short body.')).toBe('Just a short body.')
  })
})

describe('selectFeedPosts', () => {
  const rows: FeedRow[] = [
    row('post/en/a', '2024-01-01'),
    row('post/en/b', '2024-03-01'),
    row('page/en/about', '2024-09-01'),            // page → excluded
    row('post/en/draft', '2024-12-01', { status: 'draft' }), // draft → excluded
    row('post/en/hidden', '2024-12-01', { published: false }), // hidden → excluded
    row('post/fr/c', '2024-12-01'),                // non-en → excluded
  ]
  it('keeps published en posts only, newest first, capped at limit', () => {
    const out = selectFeedPosts(rows, 10).map((r) => r.id)
    expect(out).toEqual(['post/en/b', 'post/en/a'])
  })
  it('caps at the limit', () => {
    expect(selectFeedPosts(rows, 1).map((r) => r.id)).toEqual(['post/en/b'])
  })
})

describe('toFeedItem', () => {
  it('builds an absolute-path link and falls back to excerpt for description', () => {
    const item = toFeedItem(row('post/en/my-post', '2024-01-01', {}, 'Body text here.'))
    expect(item.link).toBe('/post/my-post')
    expect(item.description).toBe('Body text here.')
  })
  it('prefers frontmatter description/summary', () => {
    expect(toFeedItem(row('post/en/x', '2024-01-01', { description: 'D' })).description).toBe('D')
    expect(toFeedItem(row('post/en/x', '2024-01-01', { summary: 'S' })).description).toBe('S')
  })
})
