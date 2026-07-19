import { describe, it, expect } from 'vitest'
import {
  parseSettings,
  parseSettingsWithWarnings
} from '../../src/settings/schema'
import { DEFAULT_SETTINGS } from '../../src/settings/defaults'
import { SLUG_SEGMENT } from '../../src/permalinks/pattern'

/** #656 — one wrong type must reset only the field that is wrong. The old
 *  all-or-nothing `settingsSchema.safeParse(raw)` reverted EVERY group (including
 *  `permalinks.patterns`, which owns every published URL) on a single bad key. */
describe('parseSettings resilience (#656)', () => {
  const goodish = {
    general: { title: 'My Blog' },
    reading: {
      // the poison pill: a string where a number belongs
      listPageSize: '25',
      postsPerPage: 9,
      feed: { enabled: true, items: 42 }
    },
    permalinks: { patterns: { post: 'blog/:slug' }, uncategorized: 'misc' },
    identity: { name: 'Ada' },
    media: { imageFormat: 'avif' as const }
  }

  it('a wrong-typed reading field resets ONLY that field', () => {
    const out = parseSettings(goodish)
    expect(out.reading.listPageSize).toBe(DEFAULT_SETTINGS.reading.listPageSize)
    expect(out.reading.postsPerPage).toBe(9)
    expect(out.reading.feed).toEqual({ enabled: true, items: 42 })
  })

  it('a wrong-typed reading field does not disturb the other groups', () => {
    const out = parseSettings(goodish)
    expect(out.general.title).toBe('My Blog')
    expect(out.identity.name).toBe('Ada')
    expect(out.media.imageFormat).toBe('avif')
  })

  it('a wrong-typed reading field does not revert permalink patterns', () => {
    // The regression that motivated #656: reverted patterns silently move every
    // published URL at the next build, and diffRedirects then 301s away from them.
    const out = parseSettings(goodish)
    expect(out.permalinks.patterns).toEqual({ post: 'blog/:slug' })
    expect(out.permalinks.uncategorized).toBe('misc')
  })

  it('keeps unknown future top-level groups even when a known group is malformed', () => {
    const out = parseSettings({
      reading: { listPageSize: '25' },
      future: { widths: [400, 800] }
    }) as unknown as Record<string, unknown>
    expect(out.future).toEqual({ widths: [400, 800] })
  })

  it('a bad nested field resets only itself, not its siblings or its parent', () => {
    const out = parseSettings({
      reading: {
        homepage: 'page/en/about',
        feed: { enabled: true, items: 'lots' },
        markdown: { mode: 'index', style: 'nope' }
      }
    })
    expect(out.reading.homepage).toBe('page/en/about')
    expect(out.reading.feed).toEqual({
      enabled: true,
      items: DEFAULT_SETTINGS.reading.feed.items
    })
    expect(out.reading.markdown).toEqual({
      mode: 'index',
      style: DEFAULT_SETTINGS.reading.markdown.style
    })
  })

  it('a whole group of the wrong shape resets only that group', () => {
    const out = parseSettings({
      general: { title: 'Kept' },
      reading: 'not an object'
    })
    expect(out.general.title).toBe('Kept')
    expect(out.reading).toEqual(DEFAULT_SETTINGS.reading)
  })

  // --- Table test: missing / null / wrong-type / extra-key × each group --------
  const groups = [
    ['general', { title: 'T' }, { title: 5 }],
    ['reading', { postsPerPage: 7 }, { postsPerPage: 'seven' }],
    ['media', { imageLqip: true }, { imageLqip: 'yes' }],
    ['identity', { name: 'N' }, { name: 12 }],
    ['permalinks', { uncategorized: 'misc' }, { uncategorized: 'NOT A SLUG' }]
  ] as const

  for (const [name, good, bad] of groups) {
    describe(`group "${name}"`, () => {
      it('missing → defaults', () => {
        const out = parseSettings({}) as unknown as Record<string, unknown>
        expect(out[name]).toEqual(
          (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[name]
        )
      })
      it('null → defaults, other groups untouched', () => {
        const raw: Record<string, unknown> = {
          reading: { postsPerPage: 9 },
          permalinks: { patterns: { post: 'blog/:slug' } }
        }
        raw[name] = null
        const out = parseSettings(raw) as unknown as Record<string, unknown>
        expect(out[name]).toEqual(
          (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[name]
        )
        if (name !== 'reading')
          expect((out.reading as { postsPerPage: number }).postsPerPage).toBe(9)
        if (name !== 'permalinks')
          expect(
            (out.permalinks as { patterns: Record<string, string> }).patterns
          ).toEqual({ post: 'blog/:slug' })
      })
      it('wrong-typed field → that field defaults, the good sibling groups survive', () => {
        const out = parseSettings({
          [name]: bad,
          general: { title: 'Kept' },
          permalinks: { patterns: { post: 'blog/:slug' } }
        }) as unknown as Record<string, unknown>
        if (name !== 'general')
          expect((out.general as { title: string }).title).toBe('Kept')
        if (name !== 'permalinks')
          expect(
            (out.permalinks as { patterns: Record<string, string> }).patterns
          ).toEqual({ post: 'blog/:slug' })
      })
      it('extra unknown key inside the group is preserved (forward-compat)', () => {
        const out = parseSettings({
          [name]: { ...good, futureField: 'keep me' }
        }) as unknown as Record<string, Record<string, unknown>>
        expect(out[name]?.futureField).toBe('keep me')
      })
    })
  }
})

describe('parseSettingsWithWarnings (#656)', () => {
  it('reports the dropped key so a caller can surface it', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      reading: { listPageSize: '25' }
    })
    expect(settings.reading.listPageSize).toBe(
      DEFAULT_SETTINGS.reading.listPageSize
    )
    expect(warnings.join('\n')).toContain('reading.listPageSize')
  })

  it('reports a dropped permalink pattern', () => {
    const { settings, warnings } = parseSettingsWithWarnings({
      permalinks: { patterns: { post: '/absolute/:slug', page: ':slug' } }
    })
    expect(settings.permalinks.patterns).toEqual({ page: ':slug' })
    expect(warnings.join('\n')).toContain('permalinks.patterns.post')
  })

  it('is silent on clean input', () => {
    const { warnings } = parseSettingsWithWarnings({
      general: { title: 'T' },
      reading: { postsPerPage: 9 }
    })
    expect(warnings).toEqual([])
  })
})

/** #671 — `schema.ts` used to re-declare `/^[a-z0-9-]+$/`, an exact copy of
 *  `SLUG_SEGMENT` from a module it already imported. Two copies of a URL-safety rule
 *  drift; this pins the settings validator to the shared one. */
describe('permalinks.uncategorized uses the shared SLUG_SEGMENT rule (#671)', () => {
  const cases = [
    'misc',
    'my-bucket',
    'a1',
    'NOT-A-SLUG',
    'has space',
    'has/slash',
    'has.dot',
    'ünicode',
    ''
  ]
  for (const value of cases) {
    it(`agrees with SLUG_SEGMENT for ${JSON.stringify(value)}`, () => {
      const accepted =
        parseSettings({ permalinks: { uncategorized: value } }).permalinks
          .uncategorized === value
      expect(accepted).toBe(SLUG_SEGMENT.test(value))
    })
  }
})
