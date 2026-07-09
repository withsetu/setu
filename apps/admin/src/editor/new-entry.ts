import type { DataPort, GitPort } from '@setu/core'
import {
  parseContentPath,
  formatFrontmatterDate,
  newCid,
  entrySlugify,
  RESERVED_ENTRY_SLUG
} from '@setu/core'

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

/** Sentinel slug for the "compose a new entry" route (`/edit/<collection>/<locale>/new`).
 *  Single-sourced in core (rename/slug.ts) so the rename service refuses it too. */
export const NEW_SLUG = RESERVED_ENTRY_SLUG

/** Title → URL-safe slug. The implementation lives in @setu/core (`entrySlugify`,
 *  rename/slug.ts) so minting, rename validation, and auto-derive share ONE
 *  vocabulary; re-exported here to keep existing admin imports stable. */
export const slugify = entrySlugify

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
