import { describe, it, expect } from 'vitest'
import { diffRedirects } from '../../src/redirects/diff'

const m = (o: Record<string, string>) => new Map(Object.entries(o))

describe('diffRedirects', () => {
  it('emits a from→to redirect when an id’s path changes', () => {
    expect(
      diffRedirects(m({ 'post/en/a': '/x' }), m({ 'post/en/a': '/y' }), [])
    ).toEqual([{ from: '/x', to: '/y' }])
  })

  it('emits nothing when no path changed', () => {
    expect(
      diffRedirects(m({ 'post/en/a': '/x' }), m({ 'post/en/a': '/x' }), [])
    ).toEqual([])
  })

  it('ignores added ids (not in prev → no old URL to redirect)', () => {
    expect(diffRedirects(m({}), m({ 'post/en/a': '/x' }), [])).toEqual([])
  })

  it('ignores removed ids (deleted content → out of scope, no target)', () => {
    expect(diffRedirects(m({ 'post/en/a': '/x' }), m({}), [])).toEqual([])
  })

  it('collapses a chain: existing A→old plus old→new yields A→new (and old→new)', () => {
    const out = diffRedirects(
      m({ 'post/en/a': '/old' }),
      m({ 'post/en/a': '/new' }),
      [{ from: '/ancient', to: '/old' }]
    )
    expect(out).toContainEqual({ from: '/ancient', to: '/new' })
    expect(out).toContainEqual({ from: '/old', to: '/new' })
    // no stale hop left pointing at the now-redirected /old
    expect(out).not.toContainEqual({ from: '/ancient', to: '/old' })
  })

  it('stops a batch chain at the first live path (a: /1→/2, b: /2→/3 ⇒ only /1→/2)', () => {
    // #657: `a` now LIVES at /2, so /2 must not be redirected away, and /1 (a's old
    // URL) must land on a's new home /2 — not on b's page at /3. The old behaviour
    // collapsed straight through to /3 and also emitted /2→/3, burying a's page.
    const out = diffRedirects(
      m({ 'post/en/a': '/1', 'post/en/b': '/2' }),
      m({ 'post/en/a': '/2', 'post/en/b': '/3' }),
      []
    )
    expect(out).toEqual([{ from: '/1', to: '/2' }])
  })

  it('drops a self-redirect (from === to after collapse)', () => {
    // A page moved away and back: existing /a→/b, then /b→/a ⇒ /a→/a must be dropped.
    const out = diffRedirects(
      m({ 'post/en/x': '/b' }),
      m({ 'post/en/x': '/a' }),
      [{ from: '/a', to: '/b' }]
    )
    expect(out.every((r) => r.from !== r.to)).toBe(true)
    expect(out.some((r) => r.from === '/a')).toBe(false)
  })

  it('keeps one entry per `from` (dedupes)', () => {
    const out = diffRedirects(
      m({ 'post/en/a': '/x' }),
      m({ 'post/en/a': '/y' }),
      [{ from: '/x', to: '/somewhere-stale' }]
    )
    expect(out.filter((r) => r.from === '/x')).toHaveLength(1)
    expect(out.find((r) => r.from === '/x')?.to).toBe('/y')
  })

  it('is stable-sorted by `from` for deterministic output', () => {
    const out = diffRedirects(
      m({ 'post/en/a': '/c', 'post/en/b': '/a', 'post/en/z': '/b' }),
      m({ 'post/en/a': '/c2', 'post/en/b': '/a2', 'post/en/z': '/b2' }),
      []
    )
    expect(out.map((r) => r.from)).toEqual([...out.map((r) => r.from)].sort())
  })
})

/** #657 — a redirect whose `from` is a path something currently LIVES at makes that
 *  page unreachable on Cloudflare Pages, where `_redirects` is evaluated ahead of
 *  static assets. Never emit one, whatever the snapshot claims. */
describe('diffRedirects never 301s away from a live path (#657)', () => {
  it('drops a fresh redirect whose from is now occupied by another id', () => {
    const prev = { a: '/blog/hello' }
    const next = { a: '/blog/hello-2', b: '/blog/hello' }
    expect(diffRedirects(prev, next, [])).toEqual([])
  })

  it('drops a pre-existing redirect that a new page has since reclaimed', () => {
    const prev = { a: '/blog/hello-2' }
    const next = { a: '/blog/hello-2', b: '/blog/old' }
    const existing = [{ from: '/blog/old', to: '/blog/hello-2' }]
    expect(diffRedirects(prev, next, existing)).toEqual([])
  })

  it('still emits redirects whose from is genuinely vacant', () => {
    const prev = { a: '/blog/old' }
    const next = { a: '/blog/new' }
    expect(diffRedirects(prev, next, [])).toEqual([
      { from: '/blog/old', to: '/blog/new' }
    ])
  })
})
