import { describe, it, expect } from 'vitest'
import { resolvePermalink } from '../../src/permalinks/resolve'

const post = {
  collection: 'post',
  locale: 'en',
  slug: 'hello-world',
  date: Date.UTC(2026, 5, 20),
  categories: ['recipes']
}

describe('resolvePermalink', () => {
  it('substitutes all tokens', () => {
    expect(
      resolvePermalink(
        post,
        'blog/:year/:month/:day/:category/:collection/:slug'
      ).path
    ).toBe('blog/2026/06/20/recipes/post/hello-world')
  })
  it('reproduces the legacy scheme via the default pattern', () => {
    expect(resolvePermalink(post, ':collection/:slug').path).toBe(
      'post/hello-world'
    )
  })
  it('zero-pads month and day (UTC)', () => {
    const jan = { ...post, date: Date.UTC(2026, 0, 3) }
    expect(resolvePermalink(jan, ':year/:month/:day/:slug').path).toBe(
      '2026/01/03/hello-world'
    )
  })
  it('date token but no date → bare :slug + a warning', () => {
    const r = resolvePermalink({ ...post, date: null }, 'blog/:year/:slug')
    expect(r.path).toBe('hello-world')
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/no date/)
  })
  it(':category with no categories → uncategorized (default + configurable)', () => {
    expect(
      resolvePermalink({ ...post, categories: [] }, ':category/:slug').path
    ).toBe('uncategorized/hello-world')
    expect(
      resolvePermalink({ ...post, categories: [] }, ':category/:slug', {
        uncategorized: 'misc'
      }).path
    ).toBe('misc/hello-world')
  })
  it(':category uses the first category', () => {
    expect(
      resolvePermalink(
        { ...post, categories: ['recipes', 'life'] },
        ':category/:slug'
      ).path
    ).toBe('recipes/hello-world')
  })
  it(':category interpolates a valid slug category with no warning', () => {
    const r = resolvePermalink(
      { ...post, categories: ['news'] },
      ':category/:slug'
    )
    expect(r.path).toBe('news/hello-world')
    expect(r.warnings).toEqual([])
  })
  it(':category with a non-slug value (space/case) → uncategorized + warning', () => {
    const r = resolvePermalink(
      { ...post, categories: ['My Cat'] },
      ':category/:slug'
    )
    expect(r.path).toBe('uncategorized/hello-world')
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/My Cat/)
    expect(r.warnings[0]).toMatch(/uncategorized/)
  })
  it(':category with a path separator cannot inject URL segments', () => {
    const r = resolvePermalink(
      { ...post, categories: ['a/b'] },
      ':category/:slug'
    )
    expect(r.path).toBe('uncategorized/hello-world')
    expect(r.warnings).toHaveLength(1)
  })
  it(':category with a unicode value → uncategorized + warning', () => {
    const r = resolvePermalink(
      { ...post, categories: ['über'] },
      ':category/:slug'
    )
    expect(r.path).toBe('uncategorized/hello-world')
    expect(r.warnings).toHaveLength(1)
  })
  it(':category non-slug fallback honors the configured uncategorized slug', () => {
    const r = resolvePermalink(
      { ...post, categories: ['My Cat'] },
      ':category/:slug',
      { uncategorized: 'misc' }
    )
    expect(r.path).toBe('misc/hello-world')
    expect(r.warnings).toHaveLength(1)
  })
  it('non-default locale gets a leading prefix; default is unprefixed', () => {
    expect(
      resolvePermalink({ ...post, locale: 'fr' }, ':collection/:slug').path
    ).toBe('fr/post/hello-world')
    expect(resolvePermalink(post, ':collection/:slug').path).toBe(
      'post/hello-world'
    )
  })
  it('multi-segment slugs pass through', () => {
    expect(
      resolvePermalink({ ...post, slug: 'docs/intro' }, ':slug').path
    ).toBe('docs/intro')
  })
  it('warnings are empty on the happy path', () => {
    expect(resolvePermalink(post, ':collection/:slug').warnings).toEqual([])
  })
})

/** #670 — `pattern.ts` claimed SLUG_SEGMENT was shared so a rejected value "can never be
 *  interpolated into a URL either", but `resolvePermalink` guarded only `:category`;
 *  `:slug` and `:collection` were raw. */
describe('resolvePermalink guards :slug and :collection (#670)', () => {
  const ref = (over: Record<string, unknown> = {}) => ({
    collection: 'post',
    locale: 'en',
    slug: 'hello',
    ...over
  })

  it('passes ordinary slugs through untouched', () => {
    const r = resolvePermalink(ref(), ':collection/:slug')
    expect(r.path).toBe('post/hello')
    expect(r.warnings).toEqual([])
  })

  it('passes non-ASCII slugs the system itself mints through untouched', () => {
    // entrySlugify keeps \p{L}; SLUG_SEGMENT would have rejected these.
    for (const slug of ['über-uns', 'café', 'à-propos']) {
      const r = resolvePermalink(ref({ slug }), ':slug')
      expect(r.path).toBe(slug)
      expect(r.warnings).toEqual([])
    }
  })

  it('a slug containing "/" cannot mint an extra path segment', () => {
    // Nested slugs are supported (content/<c>/<l>/docs/intro.mdoc → 'docs/intro'), so the
    // separators stay — what must not survive is a dot segment that climbs out.
    const r = resolvePermalink(
      ref({ slug: 'a/../../etc' }),
      ':collection/:slug'
    )
    expect(r.path.split('/')).not.toContain('..')
    expect(r.path).toBe('post/a/%2E%2E/%2E%2E/etc')
    expect(r.warnings.join('\n')).toContain(':slug')
  })

  it('URL-structural characters in a slug are percent-encoded, with a warning', () => {
    const r = resolvePermalink(ref({ slug: 'a?b#c' }), ':slug')
    expect(r.path).toBe('a%3Fb%23c')
    expect(r.warnings).toHaveLength(1)
  })

  it('guards :collection the same way', () => {
    // A collection is ONE directory, so its '/' is encoded away rather than kept.
    const r = resolvePermalink(
      ref({ collection: '../secret' }),
      ':collection/:slug'
    )
    expect(r.path.split('/')).toHaveLength(2)
    expect(r.path).toBe('..%2Fsecret/hello')
    expect(r.warnings.join('\n')).toContain(':collection')
  })

  it('every character the guard flags is actually changed by the remedy', () => {
    // #714a: the guard flagged `'` but the remedy did not act on it —
    // `encodeURIComponent` leaves `'` unescaped (it sits in that function's
    // unescaped set with `! ~ * ( )`), so the warning named an input and an
    // output that were byte-identical. A guard that reports success without
    // acting is worse than no guard at all, because it stops anyone looking.
    //
    // Asserted against `:collection` (NOT nested) so every character goes
    // through the same encode path — a nested `:slug` keeps its `/` by design.
    // This pins the CONTRACT, not one character: whatever `URL_HOSTILE` flags,
    // the served value must actually differ from the raw input.
    const hostile = [
      '\u0000',
      '\u0001',
      '\u001f',
      ' ',
      '\u007f',
      '\u009f',
      '/',
      '\\',
      '?',
      '#',
      '%',
      '<',
      '>',
      '"',
      "'",
      '`',
      '{',
      '}',
      '|',
      '^',
      '[',
      ']'
    ]
    for (const ch of hostile) {
      const collection = `a${ch}b`
      const r = resolvePermalink(ref({ collection }), ':collection')
      expect(
        r.warnings,
        `hostile character ${JSON.stringify(ch)} was not flagged`
      ).toHaveLength(1)
      expect(
        r.path,
        `hostile character ${JSON.stringify(ch)} survived the remedy`
      ).not.toBe(collection)
    }
  })

  it('percent-encodes an apostrophe rather than reporting a no-op (#714a)', () => {
    const r = resolvePermalink(ref({ slug: "o'brien" }), ':slug')
    expect(r.path).toBe('o%27brien')
    expect(r.warnings).toHaveLength(1)
    // The warning must name the value actually served, not echo the input.
    expect(r.warnings[0]).toContain('o%27brien')
  })

  it('encoding is injective — two unsafe slugs never merge onto one URL', () => {
    const a = resolvePermalink(ref({ slug: 'a b' }), ':slug').path
    const b = resolvePermalink(ref({ slug: 'a-b' }), ':slug').path
    expect(a).not.toBe(b)
  })

  it('an empty slug never collapses the segment away', () => {
    const r = resolvePermalink(ref({ slug: '' }), ':collection/:slug')
    expect(r.path).toBe('post/untitled')
    expect(r.warnings).toHaveLength(1)
  })

  it('nested slugs still pass through with their separators', () => {
    const r = resolvePermalink(ref({ slug: 'docs/intro' }), ':slug')
    expect(r.path).toBe('docs/intro')
    expect(r.warnings).toEqual([])
  })
})
