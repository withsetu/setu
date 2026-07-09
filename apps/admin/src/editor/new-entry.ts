import type { DataPort, GitPort } from '@setu/core'
import { parseContentPath, formatFrontmatterDate, newCid } from '@setu/core'

/** Frontmatter a freshly-composed entry starts with. Stamped with a stable `cid` (survives a
 *  later slug rename — powers auto-301 redirects #252 / #389) and today's date so date-pattern
 *  permalinks resolve by default; the author can clear the date back to date-less in the editor.
 *  `now` and `cid` are injectable for tests. */
export function composeInitialMetadata(
  now: Date = new Date(),
  cid: string = newCid()
): Record<string, unknown> {
  return { cid, date: formatFrontmatterDate(now) }
}

/** Sentinel slug for the "compose a new entry" route (`/edit/<collection>/<locale>/new`). */
export const NEW_SLUG = 'new'

/** Title → URL-safe slug. Lowercase, words joined by single hyphens; drops punctuation.
 *  Returns '' for an empty/symbol-only title (callers fall back to 'untitled'). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '') // keep letters, numbers, whitespace, underscore, hyphen
    .replace(/[\s_]+/g, '-') // whitespace + underscores → hyphen separators
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** First free slug: `base` (or 'untitled' if empty), else `base-2`, `base-3`, …
 *  `taken` is the set of slugs already in use (including the `new` sentinel). */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = base || 'untitled'
  if (!taken.has(root)) return root
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Slugs already used in (collection, locale): live drafts + committed entries, plus the
 *  reserved `new` sentinel, so a minted slug never collides or shadows the compose route. */
export async function existingSlugs(
  data: DataPort,
  git: GitPort,
  collection: string,
  locale: string
): Promise<Set<string>> {
  const taken = new Set<string>([NEW_SLUG])
  for (const d of await data.listDrafts({ collection })) {
    if (d.locale === locale) taken.add(d.slug)
  }
  for (const p of await git.list(`content/${collection}/`)) {
    const ref = parseContentPath(p)
    if (ref && ref.locale === locale) taken.add(ref.slug)
  }
  return taken
}

/** Mint a unique slug for a new entry from its title (fallback 'untitled'). */
export async function mintSlug(
  data: DataPort,
  git: GitPort,
  collection: string,
  locale: string,
  title: string
): Promise<string> {
  return uniqueSlug(
    slugify(title),
    await existingSlugs(data, git, collection, locale)
  )
}
