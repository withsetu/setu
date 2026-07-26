import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings } from '@setu/core'
import type { SiteSettings } from '@setu/core'
import { patchSettingsGroup } from '../src/screens/settings/settings-group-patch'

/**
 * #956: five settings screens loaded `parseSettings(raw).<group>` — the SALVAGED reading, in which
 * a value the salvage layer rejected has already been replaced by a default or dropped — and then
 * wrote that reading back as the whole group. So a value that arrived by `git push` and failed
 * validation was ERASED from Git by an unrelated save on that screen, under a "Settings saved"
 * toast. This is the patch that replaced those writes.
 *
 * Every case below is a real stored shape from one of the five groups, named in the test title, so
 * the per-shape reasoning (flat / nested sub-group / open-keyed map / array) is pinned here rather
 * than argued in prose.
 */

/** The screens' own load path: `parseSettings(raw).<group>` is what lands in state. */
const loaded = <K extends keyof SiteSettings>(
  raw: Record<string, unknown>,
  group: K
): SiteSettings[K] => parseSettings(raw)[group]

describe('patchSettingsGroup (#956)', () => {
  describe('flat groups (general, media)', () => {
    it('writes only the field that changed', () => {
      const raw = { general: { title: 'Old', tagline: 'T' } }
      const published = loaded(raw, 'general')
      const out = patchSettingsGroup(raw.general, published, {
        ...published,
        title: 'New'
      })
      expect(out).toEqual({ title: 'New', tagline: 'T' })
    })

    // THE #956 case for media: `imageFormat: "nope"` is reset to the default at parse, so the old
    // whole-group write erased it the next time an admin toggled LQIP.
    it('an LQIP toggle does not erase a stored imageFormat the salvage layer rejected', () => {
      const raw = { media: { imageFormat: 'nope', imageLqip: false } }
      const published = loaded(raw, 'media')
      expect(published.imageFormat).toBe(DEFAULT_SETTINGS.media.imageFormat)
      const out = patchSettingsGroup(raw.media, published, {
        ...published,
        imageLqip: true
      })
      expect(out.imageLqip).toBe(true)
      expect(out.imageFormat).toBe('nope')
    })

    it('a title save does not erase a stored value in a sibling group field', () => {
      // general has no rejectable field shape of its own (every field is `z.string()`), so the
      // sibling case that matters for it is an unknown FUTURE field a newer build wrote.
      const raw = { general: { title: 'Old', futureField: { x: 1 } } }
      const published = loaded(raw, 'general')
      const out = patchSettingsGroup(raw.general, published, {
        ...published,
        title: 'New'
      })
      expect(out.futureField).toEqual({ x: 1 })
    })
  })

  describe('nested sub-groups (reading)', () => {
    // `reading.feed.items: "many"` is dropped by the nested salvage, one level down.
    it('a searchEngineVisible toggle does not erase a rejected reading.feed.items', () => {
      const raw = {
        reading: {
          searchEngineVisible: true,
          feed: { enabled: true, items: 'many' }
        }
      }
      const published = loaded(raw, 'reading')
      expect(published.feed.items).toBe(DEFAULT_SETTINGS.reading.feed.items)
      const out = patchSettingsGroup(raw.reading, published, {
        ...published,
        searchEngineVisible: false
      })
      expect(out.searchEngineVisible).toBe(false)
      expect(out.feed).toEqual({ enabled: true, items: 'many' })
    })

    // The per-FIELD rule applies inside a sub-group too: changing feed.enabled must leave the
    // rejected sibling `items` alone. A "write the whole salvaged sub-group" fix would lose it.
    it('changing feed.enabled keeps the rejected feed.items beside it', () => {
      const raw = { reading: { feed: { enabled: false, items: 'many' } } }
      const published = loaded(raw, 'reading')
      const out = patchSettingsGroup(raw.reading, published, {
        ...published,
        feed: { ...published.feed, enabled: true }
      })
      expect(out.feed).toEqual({ enabled: true, items: 'many' })
    })

    it('leaves a sub-group the screen does not edit absent rather than writing its defaults', () => {
      // ReadingSettings has no control for `markdown` or `relatedPosts`, yet it used to write the
      // salvaged (i.e. default) values of both on every save.
      const raw = { reading: { searchEngineVisible: true } }
      const published = loaded(raw, 'reading')
      const out = patchSettingsGroup(raw.reading, published, {
        ...published,
        searchEngineVisible: false
      })
      expect(out).toEqual({ searchEngineVisible: false })
    })

    it('a non-object stored sub-group is left alone when nothing in it changed', () => {
      const raw = { reading: { listPageSize: 10, feed: 7 } }
      const published = loaded(raw, 'reading')
      const out = patchSettingsGroup(raw.reading, published, {
        ...published,
        listPageSize: 25
      })
      expect(out.feed).toBe(7)
    })
  })

  describe('open-keyed maps (permalinks.patterns)', () => {
    // The worst case in #956: a dropped pattern owns every published URL for its collection.
    it('editing one collection keeps a stored pattern that failed validation', () => {
      const raw = {
        permalinks: {
          patterns: { post: '/absolute/:slug', page: ':slug' },
          uncategorized: 'category'
        }
      }
      const published = loaded(raw, 'permalinks')
      expect(published.patterns.post).toBeUndefined() // salvagePatterns dropped it
      const out = patchSettingsGroup(raw.permalinks, published, {
        ...published,
        patterns: { ...published.patterns, page: 'pages/:slug' }
      })
      expect(out.patterns).toEqual({
        post: '/absolute/:slug',
        page: 'pages/:slug'
      })
    })

    it('a category-base save does not erase a stored pattern that failed validation', () => {
      const raw = { permalinks: { patterns: { post: ':year/../:slug' } } }
      const published = loaded(raw, 'permalinks')
      expect(published.patterns.post).toBeUndefined()
      const out = patchSettingsGroup(raw.permalinks, published, {
        ...published,
        uncategorized: 'misc'
      })
      expect(out.uncategorized).toBe('misc')
      expect(out.patterns).toEqual({ post: ':year/../:slug' })
    })

    it('a rejected uncategorized survives a pattern edit', () => {
      const raw = {
        permalinks: { uncategorized: 'Not Valid!', patterns: { post: ':slug' } }
      }
      const published = loaded(raw, 'permalinks')
      expect(published.uncategorized).toBe(
        DEFAULT_SETTINGS.permalinks.uncategorized
      )
      const out = patchSettingsGroup(raw.permalinks, published, {
        ...published,
        patterns: { post: 'blog/:slug' }
      })
      expect(out.patterns).toEqual({ post: 'blog/:slug' })
      expect(out.uncategorized).toBe('Not Valid!')
    })

    // Reset-to-default: PermalinksSettings drops an entry equal to the default scheme, and that
    // deliberate delete has to reach Git or "back to Plain" would never stick.
    it('deletes an entry the screen dropped from the map', () => {
      const raw = {
        permalinks: { patterns: { post: 'blog/:slug', page: ':slug' } }
      }
      const published = loaded(raw, 'permalinks')
      const next = { ...published.patterns }
      delete next.post
      const out = patchSettingsGroup(raw.permalinks, published, {
        ...published,
        patterns: next
      })
      expect(out.patterns).toEqual({ page: ':slug' })
    })

    it('a non-object stored patterns value is replaced only once patterns changed', () => {
      const raw = { permalinks: { patterns: 7, uncategorized: 'category' } }
      const published = loaded(raw, 'permalinks')
      // Base-only save: the junk is left exactly as stored — this function never "tidies".
      expect(
        patchSettingsGroup(raw.permalinks, published, {
          ...published,
          uncategorized: 'misc'
        }).patterns
      ).toBe(7)
      expect(
        patchSettingsGroup(raw.permalinks, published, {
          ...published,
          patterns: { post: 'blog/:slug' }
        }).patterns
      ).toEqual({ post: 'blog/:slug' })
    })
  })

  describe('arrays (identity.socialProfiles)', () => {
    // An array is compared by VALUE and written whole: the salvage layer filters non-string
    // members out of it, so an untouched list must not be written back filtered.
    it('a name save does not erase a non-string member of the stored socialProfiles', () => {
      const raw = {
        identity: { name: 'Old', socialProfiles: ['https://a.example', 42] }
      }
      const published = loaded(raw, 'identity')
      expect(published.socialProfiles).toEqual(['https://a.example'])
      const out = patchSettingsGroup(raw.identity, published, {
        ...published,
        name: 'New'
      })
      expect(out.name).toBe('New')
      expect(out.socialProfiles).toEqual(['https://a.example', 42])
    })

    it('a name save does not erase a socialProfiles that was not an array at all', () => {
      const raw = { identity: { name: 'Old', socialProfiles: 'nope' } }
      const published = loaded(raw, 'identity')
      expect(published.socialProfiles).toEqual(
        DEFAULT_SETTINGS.identity.socialProfiles
      )
      const out = patchSettingsGroup(raw.identity, published, {
        ...published,
        name: 'New'
      })
      expect(out.socialProfiles).toBe('nope')
    })

    it('writes the array whole once the admin edits it', () => {
      const raw = {
        identity: { socialProfiles: ['https://a.example', 42] }
      }
      const published = loaded(raw, 'identity')
      const out = patchSettingsGroup(raw.identity, published, {
        ...published,
        socialProfiles: ['https://a.example', 'https://b.example']
      })
      expect(out.socialProfiles).toEqual([
        'https://a.example',
        'https://b.example'
      ])
    })

    it('a reordered array counts as a change', () => {
      const raw = { identity: { socialProfiles: ['a', 'b'] } }
      const published = loaded(raw, 'identity')
      const out = patchSettingsGroup(raw.identity, published, {
        ...published,
        socialProfiles: ['b', 'a']
      })
      expect(out.socialProfiles).toEqual(['b', 'a'])
    })

    it('an entityType the salvage layer coerced survives an unrelated save', () => {
      const raw = { identity: { entityType: 'robot', name: 'Old' } }
      const published = loaded(raw, 'identity')
      expect(published.entityType).toBe(DEFAULT_SETTINGS.identity.entityType)
      const out = patchSettingsGroup(raw.identity, published, {
        ...published,
        name: 'New'
      })
      expect(out.entityType).toBe('robot')
    })
  })

  describe('shared edges', () => {
    it('a non-object stored group is replaced by the patch alone, never spread', () => {
      const published = loaded({ general: 42 }, 'general')
      const out = patchSettingsGroup(42, published, {
        ...published,
        title: 'New'
      })
      expect(out).toEqual({ title: 'New' })
    })

    it('writes nothing at all when nothing changed', () => {
      const raw = { media: { imageFormat: 'nope', imageLqip: true } }
      const published = loaded(raw, 'media')
      expect(patchSettingsGroup(raw.media, published, published)).toEqual(
        raw.media
      )
    })
  })
})
