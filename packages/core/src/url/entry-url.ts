import { resolvePermalink } from '../permalinks/resolve'
import { DEFAULT_PERMALINK_PATTERN } from '../permalinks/pattern'
import type { ResolvedPermalinkConfig } from '../permalinks/config'
export { DEFAULT_LOCALE } from './locale'
import { DEFAULT_LOCALE } from './locale'

export interface EntryRef {
  collection: string
  locale: string
  slug: string
}

/** URL path for an entry. No cfg → the legacy ':collection/:slug' scheme (upgrade-safe).
 *  The default-locale home entry stays the site root. Thin caller over resolvePermalink —
 *  NOT collision-aware; build-time callers that see the whole site use resolvePermalinkMap. */
export function entryUrlPath(
  ref: EntryRef & { date?: number | null; categories?: string[] },
  cfg?: ResolvedPermalinkConfig
): string {
  if (
    ref.collection === 'page' &&
    ref.locale === DEFAULT_LOCALE &&
    ref.slug === 'home'
  )
    return ''
  const { pattern, uncategorized } = cfg ?? {
    pattern: DEFAULT_PERMALINK_PATTERN,
    uncategorized: 'uncategorized'
  }
  return resolvePermalink(ref, pattern, { uncategorized }).path
}
