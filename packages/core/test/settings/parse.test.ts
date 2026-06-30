import { describe, it, expect } from 'vitest'
import { parseSettings } from '../../src/settings/schema'
import { DEFAULT_SETTINGS } from '../../src/settings/defaults'

describe('parseSettings', () => {
  it('returns defaults for undefined / malformed input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS)
  })

  it('fills missing general keys from defaults', () => {
    const out = parseSettings({ general: { title: 'My Blog' } })
    expect(out.general.title).toBe('My Blog')
    expect(out.general.tagline).toBe(DEFAULT_SETTINGS.general.tagline)
    expect(out.general.timezone).toBe(DEFAULT_SETTINGS.general.timezone)
  })

  it('takes provided general values over defaults', () => {
    const out = parseSettings({
      general: { title: 'T', tagline: 'G', description: 'D', timezone: 'America/New_York', dateFormat: 'YYYY-MM-DD' },
    })
    expect(out.general).toEqual({
      title: 'T',
      tagline: 'G',
      description: 'D',
      timezone: 'America/New_York',
      dateFormat: 'YYYY-MM-DD',
    })
  })

  it('preserves unknown future top-level groups (forward-compat)', () => {
    const out = parseSettings({ general: { title: 'X' }, future: { widths: [400, 800] } }) as unknown as Record<string, unknown>
    expect(out.future).toEqual({ widths: [400, 800] })
    expect((out.general as { title: string }).title).toBe('X')
  })

  it('fills the reading group from defaults when absent', () => {
    const out = parseSettings({ general: { title: 'X' } })
    expect(out.reading).toEqual(DEFAULT_SETTINGS.reading)
  })

  it('deep-merges a partial reading group (incl. nested feed/markdown)', () => {
    const out = parseSettings({ reading: { homepage: 'page/en/about', feed: { enabled: true } } })
    expect(out.reading.homepage).toBe('page/en/about')
    expect(out.reading.searchEngineVisible).toBe(DEFAULT_SETTINGS.reading.searchEngineVisible)
    expect(out.reading.feed).toEqual({ enabled: true, items: DEFAULT_SETTINGS.reading.feed.items })
    expect(out.reading.markdown).toEqual(DEFAULT_SETTINGS.reading.markdown)
  })
})
