import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSettingsWithWarnings } from '@setu/core'
import type { SiteSettings } from '@setu/core'
import { contentRepoRoot } from './content-root'

/** settings.json lives at the content-repo root (sibling of `content/`). */
function settingsFilePath(): string {
  return join(contentRepoRoot(), 'settings.json')
}

/** Site settings for the build. Read FRESH per call (so `astro dev` reflects a freshly
 *  published file). Missing/malformed → defaults (never throws). */
export function loadSiteSettings(): SiteSettings {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(settingsFilePath(), 'utf8')) as unknown
  } catch {
    raw = undefined
  }
  const { settings, warnings } = parseSettingsWithWarnings(raw)
  // A reset key silently changes what the site publishes (permalink patterns own every
  // URL), so say so at build time rather than shipping the default in silence (#656).
  for (const w of warnings) console.warn(`[setu] settings.json: ${w}`)
  return settings
}
