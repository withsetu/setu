import type { EntryRef } from '../data/types'

/** Path separators, plus NUL and the C0/C1 control ranges. */
// eslint-disable-next-line no-control-regex
const UNSAFE_SEGMENT_CHARS = /[/\\\u0000-\u001f\u007f-\u009f]/

/**
 * Is this string usable as ONE path segment of a repo-relative content path?
 *
 * Non-empty, already trimmed, no separators (`/`, `\`), no control characters or NUL,
 * and not a dot segment. Deliberately NOT `SLUG_SEGMENT` (`/^[a-z0-9-]+$/`): `entrySlugify`
 * keeps `\p{L}`, so `über-uns` and `café` are identities the system itself mints, and an
 * ASCII-only rule here would reject real posts. This is the traversal/injection class only.
 */
export function isCanonicalPathSegment(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    value === value.trim() &&
    value !== '.' &&
    value !== '..' &&
    !UNSAFE_SEGMENT_CHARS.test(value)
  )
}

/** Repo-relative path for an entry's Markdoc file:
 *  `content/<collection>/<locale>/<slug>.mdoc`.
 *
 *  THROWS on a non-canonical segment (#670). This function mints a Git WRITE path, while
 *  its inverse `parseContentPath` rejects `/` and empty segments — so unguarded
 *  interpolation could produce a path the parser would never recognise, and the API's
 *  write gate classifies permissions on exactly that parse. Most callers
 *  (publish-service, bulk-service, taxonomy/delete-service, read-service, index-service)
 *  did no validation of their own; only the rename service did. Failing loudly here makes
 *  the pair a bijection by construction rather than by caller discipline. */
export function contentPath(ref: EntryRef): string {
  for (const [field, value] of [
    ['collection', ref.collection],
    ['locale', ref.locale],
    ['slug', ref.slug]
  ] as const)
    if (!isCanonicalPathSegment(value))
      throw new Error(
        `contentPath: ${field} is not a canonical path segment (${JSON.stringify(value)})`
      )
  return `content/${ref.collection}/${ref.locale}/${ref.slug}.mdoc`
}

/** Inverse of `contentPath`: parse `content/<collection>/<locale>/<slug>.mdoc`
 *  into an `EntryRef`. Returns null for any path that does not match exactly
 *  (wrong root, wrong extension, wrong segment count, empty segment). */
export function parseContentPath(path: string): EntryRef | null {
  const match = /^content\/([^/]+)\/([^/]+)\/([^/]+)\.mdoc$/.exec(path)
  if (match === null) return null
  const [, collection, locale, slug] = match
  if (!collection || !locale || !slug) return null
  return { collection, locale, slug }
}
