import { DEFAULT_LOCALE } from '../url/locale'
import { SLUG_SEGMENT } from './pattern'

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

/** Characters that must never enter a URL path segment as raw data: the separators and
 *  control characters `isCanonicalPathSegment` covers, plus the URL-structural set
 *  (`? # %`), whitespace, and the delimiters that would otherwise need escaping. */
// eslint-disable-next-line no-control-regex
const URL_HOSTILE = /[\u0000-\u0020\u007f-\u009f/\\?#%<>"'`{}|^[\]]/

/** One `/`-delimited part of a data-derived value, safe to place in a URL path as-is? */
const isSafePart = (part: string): boolean =>
  part !== '' && part !== '.' && part !== '..' && !URL_HOSTILE.test(part)

/**
 * Guard a data-derived segment (`:slug`, `:collection`) on its way into a URL (#670).
 * `pattern.ts` claimed `SLUG_SEGMENT` made this impossible, but only `:category` was
 * guarded — these two were interpolated raw.
 *
 * NOT `SLUG_SEGMENT`: that rule is ASCII-only, while `entrySlugify` keeps `\p{L}`, so
 * `über-uns` and `café` are identities the system itself mints and an ASCII rule would
 * break every non-ASCII slug's URL. What is enforced instead is the class that can do
 * harm — dot segments, path/URL structure (`? # %`), control characters — and the fix is
 * percent-encoding, not slugifying: deterministic and INJECTIVE, so unlike auto-slugifying
 * it can never silently merge two entries onto one URL.
 *
 * `nested` is true for `:slug` only: a slug legitimately carries `/` (`docs/intro`, from
 * `content/<c>/<l>/docs/intro.mdoc`), so its parts are guarded individually and the
 * separators kept. A collection is one directory, so its `/` is encoded away.
 */
function urlSegment(
  value: string,
  token: string,
  ref: PermalinkRef,
  warnings: string[],
  nested = false
): string {
  const parts = nested ? value.split('/') : [value]
  if (parts.every(isSafePart)) return parts.join('/')
  const safe = parts
    .map((part) =>
      isSafePart(part)
        ? part
        : // encodeURIComponent leaves '.' alone (it is unreserved), so a dot segment
          // has to be escaped explicitly or it would still traverse.
          part === '.' || part === '..'
          ? part.replace(/\./g, '%2E')
          : encodeURIComponent(part)
    )
    .filter((part) => part !== '')
  const out = safe.length > 0 ? safe.join('/') : 'untitled'
  warnings.push(
    `${ref.collection}/${ref.locale}/${ref.slug}: ${token} value "${value}" is not URL-safe — ` +
      `served as "${out}"`
  )
  return out
}

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
        return urlSegment(ref.slug, ':slug', ref, warnings, true)
      case ':collection':
        return urlSegment(ref.collection, ':collection', ref, warnings)
      case ':year':
        return String(date!.getUTCFullYear()).padStart(4, '0')
      case ':month':
        return String(date!.getUTCMonth() + 1).padStart(2, '0')
      case ':day':
        return String(date!.getUTCDate()).padStart(2, '0')
      case ':category': {
        const first = ref.categories?.find((c) => c.trim() !== '')
        if (first === undefined) return uncategorized
        // Same rule the pattern validator applies to literal segments: a value
        // it would reject in a pattern must not enter the URL as data either
        // (spaces, "/", unicode, …). Validate, never auto-slugify — minting
        // URLs from unvetted frontmatter text invites collisions.
        if (!SLUG_SEGMENT.test(first)) {
          warnings.push(
            `${ref.collection}/${ref.locale}/${ref.slug}: category "${first}" is not a ` +
              `URL-safe slug (lowercase letters, digits, hyphens) — fell back to "${uncategorized}"`
          )
          return uncategorized
        }
        return first
      }
      default:
        return seg
    }
  })
  const body = out.join('/')
  const path = ref.locale === defaultLocale ? body : `${ref.locale}/${body}`
  return { path, warnings }
}
