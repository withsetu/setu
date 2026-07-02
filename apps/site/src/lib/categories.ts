import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCategories, type Category } from '@setu/core'
import { contentRepoRoot } from './content-root'

/** taxonomy/categories.yaml lives under the content-repo root. */
function categoriesFilePath(): string {
  return join(contentRepoRoot(), 'taxonomy', 'categories.yaml')
}

/** Categories from taxonomy/categories.yaml. Read fresh per call. Missing/malformed → [] (never throws). */
export function loadCategories(): Category[] {
  try {
    return parseCategories(readFileSync(categoriesFilePath(), 'utf8'))
  } catch {
    return []
  }
}
