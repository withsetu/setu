import { DEFAULT_LOCALE } from './locale'

export interface LocaleAlternate {
  /** BCP-47 locale of this variant (the 2nd id segment). */
  locale: string
  /** The variant's entry id (`collection/locale/slug`). */
  id: string
}

/** The structural translation set for an entry: every entry that shares its collection + slug,
 *  across locales. Same-slug-across-locales IS the (free) translation signal — no explicit
 *  linking frontmatter needed. Returns [] when the entry has no sibling in another locale, since
 *  a single-locale entry has no alternates to declare (emitting a lone hreflang is pointless).
 *  Sorted for stable head output: the default locale leads, then the rest alphabetically.
 *  `entryId` / `allIds` are `collection/locale/slug` ids (a slug may itself contain slashes). */
export function localeAlternates(
  entryId: string,
  allIds: Iterable<string>
): LocaleAlternate[] {
  const key = slugKey(entryId)
  if (!key) return []
  const byLocale = new Map<string, string>() // locale → id; first id per locale wins
  for (const id of allIds) {
    if (slugKey(id) !== key) continue
    const locale = id.split('/')[1]
    if (locale && !byLocale.has(locale)) byLocale.set(locale, id)
  }
  if (byLocale.size < 2) return []
  return [...byLocale.entries()]
    .map(([locale, id]) => ({ locale, id }))
    .sort((a, b) =>
      a.locale === DEFAULT_LOCALE
        ? -1
        : b.locale === DEFAULT_LOCALE
          ? 1
          : a.locale.localeCompare(b.locale)
    )
}

/** `collection␟slug` identity, ignoring the locale (2nd) segment. null if the id is malformed
 *  (fewer than 3 segments, or an empty collection/slug). */
function slugKey(id: string): string | null {
  const parts = id.split('/')
  if (parts.length < 3) return null
  const collection = parts[0]
  const slug = parts.slice(2).join('/')
  if (!collection || !slug) return null
  return `${collection}␟${slug}`
}
