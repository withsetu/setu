import { DEFAULT_LOCALE } from '@setu/core'
import { permalinkMap } from './permalinks'

// DEFAULT_LOCALE and the locale-dropping rule now live in @setu/core (entryUrlPath),
// so the site and the admin's "View Page" link share one source of truth and can't drift.
export { DEFAULT_LOCALE }

/** URL path for a content id via the site-wide collision-aware map. */
export async function urlPathOf(id: string): Promise<string> {
  const map = await permalinkMap()
  const path = map.get(id)
  if (path === undefined)
    throw new Error(`[setu] permalinks: unknown entry id "${id}"`)
  return path
}
