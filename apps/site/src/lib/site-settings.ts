import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSettings } from '@setu/core'
import type { SiteSettings } from '@setu/core'

/** settings.json lives at the content-repo root (sibling of `content/`): in dev that's
 *  `<SETU_CONTENT_DIR>/../`; otherwise this repo's root. Mirrors loadThemeOptions. */
function settingsFilePath(): string {
  const contentDir = process.env.SETU_CONTENT_DIR
  if (contentDir) return join(contentDir, '..', 'settings.json')
  return fileURLToPath(new URL('../../../../settings.json', import.meta.url))
}

/** Site settings for the build. Read FRESH per call (so `astro dev` reflects a freshly
 *  published file). Missing/malformed → defaults (never throws). */
export function loadSiteSettings(): SiteSettings {
  try {
    return parseSettings(JSON.parse(readFileSync(settingsFilePath(), 'utf8')) as unknown)
  } catch {
    return parseSettings(undefined)
  }
}
