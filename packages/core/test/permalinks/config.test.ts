import { describe, it, expect } from 'vitest'
import { resolvePermalinkConfig } from '../../src/permalinks/config'
import { parseSettings } from '../../src/settings/schema'
import { resolveConfig } from '../../src/config/resolve'

describe('resolvePermalinkConfig precedence', () => {
  const config = { permalinks: { post: 'blog/:slug' } }
  const settings = {
    permalinks: { patterns: { post: ':year/:slug' }, uncategorized: 'misc' }
  }
  it('settings override wins over config', () => {
    expect(resolvePermalinkConfig('post', config, settings)).toEqual({
      pattern: ':year/:slug',
      uncategorized: 'misc'
    })
  })
  it('config wins over the default', () => {
    expect(resolvePermalinkConfig('post', config, undefined).pattern).toBe(
      'blog/:slug'
    )
  })
  it("missing everywhere → today's default (no upgrade break)", () => {
    expect(resolvePermalinkConfig('page', undefined, undefined)).toEqual({
      pattern: ':collection/:slug',
      uncategorized: 'uncategorized'
    })
  })
  it('an INVALID settings pattern is ignored (falls through to config/default)', () => {
    const bad = {
      permalinks: {
        patterns: { post: '../evil' },
        uncategorized: 'uncategorized'
      }
    }
    expect(resolvePermalinkConfig('post', config, bad).pattern).toBe(
      'blog/:slug'
    )
  })
})

describe('settings permalinks group', () => {
  it('defaults are present', () => {
    const s = parseSettings(undefined)
    expect(s.permalinks).toEqual({
      patterns: {},
      uncategorized: 'uncategorized'
    })
  })
  it('valid patterns survive the parse; invalid ones are dropped field-level', () => {
    const s = parseSettings({
      permalinks: {
        patterns: { post: 'blog/:slug', page: '/abs/:slug' },
        uncategorized: 'Misc!'
      }
    })
    expect(s.permalinks.patterns).toEqual({ post: 'blog/:slug' })
    expect(s.permalinks.uncategorized).toBe('uncategorized') // invalid slug reset
  })
})

describe('setu.config permalinks key', () => {
  it('accepts valid per-collection patterns', () => {
    const r = resolveConfig({ permalinks: { post: 'blog/:year/:slug' } })
    expect(r.permalinks).toEqual({ post: 'blog/:year/:slug' })
  })
  it('rejects an invalid pattern loudly (config is code)', () => {
    expect(() => resolveConfig({ permalinks: { post: '../:slug' } })).toThrow()
  })
})
