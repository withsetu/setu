import { describe, it, expect } from 'vitest'
import { settingsWatchPath } from '../integrations/settings-watcher.mjs'
import { join } from 'node:path'

describe('settingsWatchPath', () => {
  it('resolves settings.json as a sibling of the content dir', () => {
    expect(settingsWatchPath({ SETU_CONTENT_DIR: '/repo/root/content' })).toBe(
      join('/repo/root', 'settings.json')
    )
  })
  it('returns null when SETU_CONTENT_DIR is not set (nothing sensible to watch)', () => {
    expect(settingsWatchPath({})).toBeNull()
  })
})
