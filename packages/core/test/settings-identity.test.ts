import { describe, it, expect } from 'vitest'
import { parseSettings } from '../src/settings/schema'
import { DEFAULT_SETTINGS } from '../src/settings/defaults'

describe('identity settings', () => {
  it('defaults to a blank organization identity when absent', () => {
    const s = parseSettings({ general: { title: 'X' } })
    expect(s.identity).toEqual(DEFAULT_SETTINGS.identity)
    expect(s.identity.entityType).toBe('organization')
    expect(s.identity.socialProfiles).toEqual([])
  })

  it('parses provided identity fields and merges over defaults', () => {
    const s = parseSettings({
      identity: {
        entityType: 'person',
        name: 'Ada Lovelace',
        url: 'https://ada.dev',
        twitterHandle: 'ada',
        socialProfiles: ['https://github.com/ada'],
      },
    })
    expect(s.identity.entityType).toBe('person')
    expect(s.identity.name).toBe('Ada Lovelace')
    expect(s.identity.url).toBe('https://ada.dev')
    expect(s.identity.twitterHandle).toBe('ada')
    expect(s.identity.socialProfiles).toEqual(['https://github.com/ada'])
    // untouched fields keep their defaults
    expect(s.identity.titleTemplate).toBe(DEFAULT_SETTINGS.identity.titleTemplate)
  })

  it('falls back to the default entityType on an invalid value', () => {
    const s = parseSettings({ identity: { entityType: 'robot' } })
    expect(s.identity.entityType).toBe('organization')
  })

  it('coerces a non-array / dirty socialProfiles to a clean string[]', () => {
    const s = parseSettings({ identity: { socialProfiles: ['a', 2, null, 'b'] } })
    expect(s.identity.socialProfiles).toEqual(['a', 'b'])
    const s2 = parseSettings({ identity: { socialProfiles: 'nope' } })
    expect(s2.identity.socialProfiles).toEqual([])
  })
})
