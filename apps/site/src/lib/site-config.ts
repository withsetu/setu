import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../setu.config'

/** File (Customizer-published) values win over the setu.config defaults. Pure. */
export function mergeThemeOptions(
  configValues: Record<string, string>,
  fileValues: Record<string, string>,
): Record<string, string> {
  return { ...configValues, ...fileValues }
}

/** The committed theme-options file lives at the content-repo root (sibling of `content/`):
 *  in dev that's `<SETU_CONTENT_DIR>/../`, the sandbox root; otherwise this repo's root. */
function themeOptionsFilePath(): string {
  const contentDir = process.env.SETU_CONTENT_DIR
  if (contentDir) return join(contentDir, '..', 'theme-options.json')
  return fileURLToPath(new URL('../../../../theme-options.json', import.meta.url))
}

function readFileValues(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(themeOptionsFilePath(), 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>
    }
  } catch {
    // missing or malformed → fall back to the config/theme defaults (never throw)
  }
  return {}
}

/** Theme option values for the build. Read FRESH per call (so `astro dev` re-reads a freshly
 *  published file on refresh): the committed `theme-options.json` over the setu.config defaults. */
export function loadThemeOptions(): Record<string, string> {
  return mergeThemeOptions(config.themeOptions ?? {}, readFileValues())
}
