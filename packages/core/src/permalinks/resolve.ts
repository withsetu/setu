import { DEFAULT_LOCALE } from '../url/locale'

/** What the resolver needs to know about one entry. `date` is the frontmatter publish date
 *  (epoch ms) — never updatedAt/git/mtime: an edit must not move a URL. */
export interface PermalinkRef {
  collection: string
  locale: string
  slug: string
  date?: number | null
  categories?: string[]
}

export interface PermalinkOptions {
  /** Slug used when the pattern has :category but the entry has none. Default 'uncategorized'. */
  uncategorized?: string
  /** Locale that stays unprefixed in URLs. Default DEFAULT_LOCALE ('en'). */
  defaultLocale?: string
}

export interface ResolvedPermalink {
  path: string
  warnings: string[]
}

const DATE_TOKENS = new Set([':year', ':month', ':day'])

/** Resolve one entry's URL path from a (valid) pattern. Pure — no I/O, no clock.
 *  Date parts are UTC: a frontmatter date is a calendar date, not an instant. */
export function resolvePermalink(
  ref: PermalinkRef,
  pattern: string,
  opts: PermalinkOptions = {}
): ResolvedPermalink {
  const uncategorized = opts.uncategorized ?? 'uncategorized'
  const defaultLocale = opts.defaultLocale ?? DEFAULT_LOCALE
  const warnings: string[] = []
  const date = ref.date == null ? null : new Date(ref.date)
  let segments = pattern.split('/')
  if (date === null && segments.some((s) => DATE_TOKENS.has(s))) {
    warnings.push(
      `${ref.collection}/${ref.locale}/${ref.slug}: pattern "${pattern}" uses a date token ` +
        `but the entry has no date — fell back to ":slug"`
    )
    segments = [':slug']
  }
  const out = segments.map((seg) => {
    switch (seg) {
      case ':slug':
        return ref.slug
      case ':collection':
        return ref.collection
      case ':year':
        return String(date!.getUTCFullYear()).padStart(4, '0')
      case ':month':
        return String(date!.getUTCMonth() + 1).padStart(2, '0')
      case ':day':
        return String(date!.getUTCDate()).padStart(2, '0')
      case ':category': {
        const first = ref.categories?.find((c) => c.trim() !== '')
        return first ?? uncategorized
      }
      default:
        return seg
    }
  })
  const body = out.join('/')
  const path = ref.locale === defaultLocale ? body : `${ref.locale}/${body}`
  return { path, warnings }
}
