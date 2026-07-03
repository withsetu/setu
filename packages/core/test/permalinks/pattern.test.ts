import { describe, it, expect } from 'vitest'
import {
  validatePermalinkPattern,
  permalinkPatternSchema,
  DEFAULT_PERMALINK_PATTERN
} from '../../src/permalinks/pattern'

describe('validatePermalinkPattern', () => {
  it('accepts the default pattern', () => {
    expect(validatePermalinkPattern(DEFAULT_PERMALINK_PATTERN)).toEqual([])
  })
  it.each([
    ':slug',
    'blog/:slug',
    ':year/:month/:day/:slug',
    ':category/:slug',
    'docs/v2/:slug'
  ])('accepts %s', (p) => expect(validatePermalinkPattern(p)).toEqual([]))
  it('rejects a pattern without :slug', () => {
    expect(validatePermalinkPattern('blog/:year')).toContainEqual(
      expect.stringContaining(':slug')
    )
  })
  it('rejects unknown tokens', () => {
    expect(validatePermalinkPattern(':postname/:slug')).toContainEqual(
      expect.stringContaining(':postname')
    )
  })
  it.each([
    '/blog/:slug',
    'blog/:slug/',
    'blog//:slug',
    '../:slug',
    './:slug',
    ''
  ])('rejects unsafe/malformed %j', (p) =>
    expect(validatePermalinkPattern(p).length).toBeGreaterThan(0)
  )
  it('rejects literal segments with uppercase or unsafe chars', () => {
    expect(validatePermalinkPattern('Blog/:slug').length).toBeGreaterThan(0)
    expect(validatePermalinkPattern('a b/:slug').length).toBeGreaterThan(0)
  })
  it('rejects tokens embedded inside a segment (whole-segment only)', () => {
    expect(validatePermalinkPattern('x:slug').length).toBeGreaterThan(0)
    expect(validatePermalinkPattern(':year-:slug').length).toBeGreaterThan(0)
  })
})

describe('permalinkPatternSchema', () => {
  it('parses a valid pattern', () => {
    expect(permalinkPatternSchema.parse('blog/:slug')).toBe('blog/:slug')
  })
  it('fails an invalid pattern with the validator messages', () => {
    expect(permalinkPatternSchema.safeParse('../:slug').success).toBe(false)
  })
})
