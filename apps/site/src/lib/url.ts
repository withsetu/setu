import { DEFAULT_LOCALE, entryUrlPath } from '@setu/core'

// DEFAULT_LOCALE and the locale-dropping rule now live in @setu/core (entryUrlPath),
// so the site and the admin's "View Page" link share one source of truth and can't drift.
export { DEFAULT_LOCALE }

// Map a content entry id ("<collection>/<locale>/<slug...>") to its URL path.
// The home entry is served at '/' by index.astro and excluded from the catch-all, so
// entryUrlPath's home → '' case is never reached through this wrapper.
export function toUrlPath(id: string): string {
  const [collection = '', locale = '', ...rest] = id.split('/')
  return entryUrlPath({ collection, locale, slug: rest.join('/') })
}
