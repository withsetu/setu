import { describe, it, expect } from 'vitest'
import { resolveHomepageEntry } from '../src/lib/homepage'

const e = (id: string, data: Record<string, unknown> = {}) => ({ id, data })
const from =
  (...entries: ReturnType<typeof e>[]) =>
  (id: string) =>
    entries.find((x) => x.id === id)

describe('resolveHomepageEntry (#1120, mirrors #165)', () => {
  it('returns the configured homepage when it exists and is published', () => {
    expect(
      resolveHomepageEntry(
        'page/en/landing',
        from(e('page/en/home'), e('page/en/landing'))
      )?.id
    ).toBe('page/en/landing')
  })
  it('falls back to page/en/home when the configured homepage is a draft', () => {
    expect(
      resolveHomepageEntry(
        'page/en/landing',
        from(e('page/en/home'), e('page/en/landing', { published: false }))
      )?.id
    ).toBe('page/en/home')
  })
  it('falls back to page/en/home when the configured homepage does not exist', () => {
    expect(
      resolveHomepageEntry('page/en/gone', from(e('page/en/home')))?.id
    ).toBe('page/en/home')
  })
  it('returns undefined when neither exists (the empty-shell root)', () => {
    expect(resolveHomepageEntry('page/en/landing', from())).toBeUndefined()
  })
  it('a noindex homepage is still the homepage (indexability is the caller’s question)', () => {
    expect(
      resolveHomepageEntry(
        'page/en/home',
        from(e('page/en/home', { seo: { noindex: true } }))
      )?.id
    ).toBe('page/en/home')
  })
})
