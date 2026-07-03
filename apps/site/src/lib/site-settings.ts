import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSettings } from '@setu/core'
import type { SiteSettings } from '@setu/core'
import { contentRepoRoot } from './content-root'

/** settings.json lives at the content-repo root (sibling of `content/`). */
function settingsFilePath(): string {
  return join(contentRepoRoot(), 'settings.json')
}

/** Site settings for the build. Read FRESH per call (so `astro dev` reflects a freshly
 *  published file). Missing/malformed → defaults (never throws). */
export function loadSiteSettings(): SiteSettings {
  try {
    return parseSettings(
      JSON.parse(readFileSync(settingsFilePath(), 'utf8')) as unknown
    )
  } catch {
    return parseSettings(undefined)
  }
}
