import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSettings } from '@setu/core'
import type { SiteSettings } from '@setu/core'

/** settings.json lives at the content-repo root (sibling of `content/`): in dev that's
 *  `<SETU_CONTENT_DIR>/../`; otherwise this repo's root. Mirrors loadThemeOptions.
 *  Uses process.cwd() (== apps/site/ at build time) rather than import.meta.url because Astro
 *  prerender bundles the compiled chunk in dist/.prerender/chunks/ — two extra levels deep —
 *  making import.meta.url-based relative paths silently resolve to the wrong directory. */
function settingsFilePath(): string {
  const contentDir = process.env.SETU_CONTENT_DIR
  if (contentDir) return join(contentDir, '..', 'settings.json')
  // cwd is apps/site/ during `astro build`; go up 2 → repo root.
  return join(process.cwd(), '..', '..', 'settings.json')
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
