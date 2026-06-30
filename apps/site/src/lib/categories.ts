import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCategories, type Category } from '@setu/core'

/** taxonomy/categories.yaml lives at the content-repo root (sibling of `content/`): in dev that's
 *  `<SETU_CONTENT_DIR>/../taxonomy/categories.yaml`; otherwise this repo's root.
 *  Uses process.cwd() (== apps/site/ at build time) rather than import.meta.url because Astro
 *  prerender bundles the compiled chunk in dist/.prerender/chunks/ — two extra levels deep —
 *  making import.meta.url-based relative paths silently resolve to the wrong directory. */
function categoriesFilePath(): string {
  const contentDir = process.env.SETU_CONTENT_DIR
  if (contentDir) return join(contentDir, '..', 'taxonomy', 'categories.yaml')
  // cwd is apps/site/ during `astro build`; go up 2 → repo root, then into taxonomy/.
  return join(process.cwd(), '..', '..', 'taxonomy', 'categories.yaml')
}

/** Categories from taxonomy/categories.yaml. Read fresh per call. Missing/malformed → [] (never throws). */
export function loadCategories(): Category[] {
  try {
    return parseCategories(readFileSync(categoriesFilePath(), 'utf8'))
  } catch {
    return []
  }
}
