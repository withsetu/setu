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

/** Is this entry the root of its locale?
 *
 *  Base convention: slug `home` in collection `page`, in ANY locale — so `page/fr/home`
 *  is `/fr/`, not `/fr/page/home` (#660; the old rule hardcoded the default locale and
 *  404'd every translated site's root).
 *
 *  `homepageId` is the resolved `reading.homepage` setting. When set it takes over the
 *  root of ITS locale — that entry becomes the root and `page/<that locale>/home` goes
 *  back to being an ordinary page. Other locales keep the base convention. Reading the
 *  homepage identity from one place is the point: the setting and this function used to
 *  disagree, so the admin "View" link and theme fallbacks pointed at the wrong page. */
function isLocaleRoot(ref: EntryRef, homepageId?: string): boolean {
  const byConvention = ref.collection === 'page' && ref.slug === 'home'
  if (homepageId === undefined) return byConvention
  if (`${ref.collection}/${ref.locale}/${ref.slug}` === homepageId) return true
  return byConvention && ref.locale !== homepageId.split('/')[1]
}

/** URL path for an entry. No cfg → the legacy ':collection/:slug' scheme (upgrade-safe).
 *  A locale's home entry is that locale's root (`''` for the default locale). Pass the
 *  resolved `reading.homepage` as `homepageId` so this agrees with what the site serves.
 *  Thin caller over resolvePermalink — NOT collision-aware; build-time callers that see
 *  the whole site use resolvePermalinkMap. */
export function entryUrlPath(
  ref: EntryRef & { date?: number | null; categories?: string[] },
  cfg?: ResolvedPermalinkConfig,
  homepageId?: string
): string {
  if (isLocaleRoot(ref, homepageId))
    return ref.locale === DEFAULT_LOCALE ? '' : ref.locale
  const { pattern, uncategorized } = cfg ?? {
    pattern: DEFAULT_PERMALINK_PATTERN,
    uncategorized: 'uncategorized'
  }
  return resolvePermalink(ref, pattern, { uncategorized }).path
}

/** The single home of Setu's trailing-slash URL policy, at the PATH level: append `/` unless the
 *  path already ends with one (the root `/` and already-slashed paths are preserved). The site
 *  serves directory-format pages (`<path>/index.html` → served at `<path>/`), so every URL that
 *  refers to an entry — the self-canonical, hreflang alternates, the sitemap `<loc>`, the RSS item
 *  `<link>`, AND the internal navigation links a reader clicks (theme cards, related, latest-posts)
 *  — must advertise that one spelling, or a crawler sees the same entry at `/about` and `/about/`
 *  and splits the signal. Lives in core because the site output layer, the theme, and the block
 *  renderers all need it and cannot share a helper from `apps/site`.
 *
 *  `entryUrlPath` above deliberately returns the SLASH-LESS form — it doubles as an Astro route
 *  param, where a trailing slash would build `<path>//index.html`. So the slash is a DISPLAY-layer
 *  concern applied here, at the href, not at the permalink source. Enforced by
 *  packages/core/test/entry-url.test.ts and apps/site/test/url-consistency.test.ts. */
export const ensureTrailingSlashPath = (path: string): string =>
  path.endsWith('/') ? path : `${path}/`
