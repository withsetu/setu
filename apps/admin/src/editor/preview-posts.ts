import { DEFAULT_LOCALE, selectPosts } from '@setu/core'
import type { ContentRow, IndexQuery, PostRow, PostsQuery } from '@setu/core'
import type { QueryAttrs, RunQuery } from './QueryPreview'

// The canvas preview of the Query and Latest Posts blocks (#1245). The published blocks
// (blocks/query/query.astro, packages/blocks/src/latest-posts/LatestPosts.astro) resolve
// committed Git content through core's `selectPosts`. The canvas reads the content index
// instead, so it fetches every candidate row and runs it through that same `selectPosts`:
// one implementation of the published / locale / sort / window rules, not a mirror of
// them. Parity is pinned by apps/admin/test/query-preview-parity.test.tsx.

/** Asks the index for every candidate row: `selectPosts` must see the whole filtered set
 *  to sort and window it, because the index has no frontmatter-date sort of its own. The
 *  http index service pages this through the server's 100-row cap. */
const ALL_ROWS = Number.MAX_SAFE_INTEGER

const isSet = (v: unknown): boolean => v !== undefined && v !== null && v !== ''

/** A numeric block attr resolved the way an Astro prop default resolves it: unset → the
 *  block's default; anything else is used as given (`selectPosts` clamps at 0). A value
 *  that is not a number fails the site build's attr validation, so the default is the
 *  only sensible preview for it. */
function numAttr(v: unknown, fallback: number): number {
  if (!isSet(v)) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** The query block's attrs resolved exactly as blocks/query/query.astro resolves its props
 *  (same defaults, `DEFAULT_LOCALE` when no locale is chosen). Latest Posts reaches here
 *  through `latestPostsQueryAttrs`, which applies that block's own count clamp. */
export function postsQueryFromAttrs(a: QueryAttrs): PostsQuery {
  const q: PostsQuery = {
    collection: isSet(a.collection) ? a.collection! : 'post',
    locale: isSet(a.locale) ? a.locale! : DEFAULT_LOCALE,
    sort: a.sort ?? 'newest',
    limit: numAttr(a.limit, 10),
    offset: numAttr(a.offset, 0)
  }
  if (isSet(a.category)) q.category = a.category
  if (isSet(a.tag)) q.tag = a.tag
  return q
}

/** An index row in the shape `selectPosts` reads. Two fields carry the site's view:
 *  - `id` is the Astro entry id (`collection/locale/slug`) the site tiebreaks on.
 *  - `published` comes from `audit.audited` — committed AND `published !== false` in the
 *    COMMITTED frontmatter — not from the lifecycle state, which also counts deploy
 *    history (a committed-hidden entry still on the last deploy is `live`) and is not
 *    what a rebuild sees. A never-committed local draft is never audited, so it drops. */
export function toPreviewPostRow(row: ContentRow): PostRow {
  const { collection, locale, slug } = row.ref
  return {
    id: `${collection}/${locale}/${slug}`,
    collection,
    locale,
    slug,
    title: row.title,
    date: row.date,
    tags: row.tags,
    categories: row.categories,
    ...(row.audit.audited ? {} : { published: false })
  }
}

/** Resolve the rows the published block would render for `attrs`, plus how many entries
 *  match in total (before the limit/offset window) for the preview's count label. */
export async function resolvePreviewPosts(
  runQuery: RunQuery,
  attrs: QueryAttrs
): Promise<{ rows: ContentRow[]; total: number }> {
  const q = postsQueryFromAttrs(attrs)
  // Narrow server-side by the filters the index shares with selectPosts; selectPosts then
  // re-applies them, so this only trims the transfer and never decides membership.
  const candidates: IndexQuery = {
    collection: q.collection,
    locale: q.locale,
    offset: 0,
    limit: ALL_ROWS
  }
  if (q.category !== undefined) candidates.category = q.category
  if (q.tag !== undefined) candidates.tag = q.tag
  const { rows } = await runQuery(candidates)

  const byId = new Map<string, ContentRow>()
  const postRows = rows.map((r) => {
    const p = toPreviewPostRow(r)
    byId.set(p.id, r)
    return p
  })
  const total = selectPosts(postRows, {
    ...q,
    offset: 0,
    limit: ALL_ROWS
  }).length
  const picked = selectPosts(postRows, q).map((p) => byId.get(p.id)!)
  return { rows: picked, total }
}
