import type { EntryRef } from '../data/types'

// The default locale is unprefixed in URLs; non-default locales keep their segment.
// Hardcoded for now — becomes config-driven when permalinks / i18n routing land.
// (Mirrors what the site historically hardcoded in apps/site/src/lib/url.ts.)
export const DEFAULT_LOCALE = 'en'

/** Map an entry to the URL path the site serves it at, WITHOUT a leading slash.
 *
 *  - The home entry (`page/<DEFAULT_LOCALE>/home`) → `''` (the site serves it at `/`).
 *  - Default-locale entry → `<collection>/<slug>` (locale segment dropped, so a
 *    single-language site has clean URLs).
 *  - Non-default-locale entry → `<collection>/<locale>/<slug>` (locale kept).
 *
 *  Single source of truth shared by the site (routing) and the admin ("View Page"),
 *  so the two can never disagree on where a page lives. Pure / Node-free. */
export function entryUrlPath(ref: EntryRef): string {
  const { collection, locale, slug } = ref
  if (collection === 'page' && locale === DEFAULT_LOCALE && slug === 'home') return ''
  if (locale === DEFAULT_LOCALE) return `${collection}/${slug}`
  return `${collection}/${locale}/${slug}`
}
