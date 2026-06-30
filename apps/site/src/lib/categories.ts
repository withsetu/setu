import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCategories, type Category } from '@setu/core'

/** taxonomy/categories.yaml lives at the content-repo root (sibling of `content/`): in dev that's
 *  `<SETU_CONTENT_DIR>/../taxonomy/categories.yaml`; otherwise this repo's root. Mirrors loadThemeOptions. */
function categoriesFilePath(): string {
  const contentDir = process.env.SETU_CONTENT_DIR
  if (contentDir) return join(contentDir, '..', 'taxonomy', 'categories.yaml')
  return fileURLToPath(new URL('../../../../taxonomy/categories.yaml', import.meta.url))
}

/** Categories from taxonomy/categories.yaml. Read fresh per call. Missing/malformed → [] (never throws). */
export function loadCategories(): Category[] {
  try {
    return parseCategories(readFileSync(categoriesFilePath(), 'utf8'))
  } catch {
    return []
  }
}
