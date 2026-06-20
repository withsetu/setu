import type { Draft, EntryRef } from '../data/types'
import type { Lifecycle } from '../lifecycle/derive'
import { deriveLifecycle } from '../lifecycle/derive'
import { contentPath } from '../publish/content-path'
import { parseMdoc, serializeMdoc } from '../markdoc/frontmatter'
import { tiptapToMarkdoc } from '../markdoc/to-markdoc'
import { normalizeTags } from '../tags/normalize'

/** One row in the merged content list: an entry that exists as a draft, as a
 *  committed Git file, or both. */
export interface ContentRow {
  ref: EntryRef
  /** draft title → committed frontmatter title → slug. */
  title: string
  locale: string
  lifecycle: Lifecycle
  /** Draft's updatedAt (epoch ms); null for entries that live only in Git. */
  updatedAt: number | null
  hasDraft: boolean
  /** Normalized, deduped tags for this entry (draft's tags win when a draft exists). */
  tags: string[]
}

export interface ListContentEntriesInput {
  drafts: Draft[]
  committed: { ref: EntryRef; content: string }[]
  /** The live content at a repo path, or null if not deployed. */
  deployedAt: (path: string) => string | null
}

/** A collision-proof identity key. Uses NUL (impossible in a path segment) so
 *  distinct refs can never alias even if a segment contained a slash. */
const keyOf = (r: EntryRef): string => `${r.collection}\0${r.locale}\0${r.slug}`

/** Merge DB drafts with committed Git entries into one status-aware list. The
 *  draft is the identity holder (an entry with both yields a single row). Pure —
 *  the reindex derivation; topology supplies `deployedAt`. */
export function listContentEntries(input: ListContentEntriesInput): ContentRow[] {
  const { drafts, committed, deployedAt } = input

  const draftByKey = new Map<string, Draft>()
  for (const d of drafts) draftByKey.set(keyOf(d), d)
  const committedByKey = new Map<string, string>()
  for (const c of committed) committedByKey.set(keyOf(c.ref), c.content)

  // Union of refs: drafts first (stable), then committed-only.
  const order: EntryRef[] = []
  const seen = new Set<string>()
  for (const d of drafts) {
    const k = keyOf(d)
    if (!seen.has(k)) {
      seen.add(k)
      order.push({ collection: d.collection, locale: d.locale, slug: d.slug })
    }
  }
  for (const c of committed) {
    const k = keyOf(c.ref)
    if (!seen.has(k)) {
      seen.add(k)
      order.push(c.ref)
    }
  }

  return order.map((ref) => {
    const draft = draftByKey.get(keyOf(ref)) ?? null
    const committedStr = committedByKey.get(keyOf(ref)) ?? null
    const draftStr = draft
      ? serializeMdoc({ frontmatter: draft.metadata, body: tiptapToMarkdoc(draft.content) })
      : null
    const lifecycle = deriveLifecycle({
      draft: draftStr,
      committed: committedStr,
      deployed: deployedAt(contentPath(ref)),
    })
    return {
      ref,
      title: titleOf(draft, committedStr, ref.slug),
      locale: ref.locale,
      lifecycle,
      updatedAt: draft ? draft.updatedAt : null,
      hasDraft: draft !== null,
      tags: tagsOf(draft, committedStr),
    }
  })
}

function titleOf(draft: Draft | null, committedStr: string | null, slug: string): string {
  if (draft) {
    const t = draft.metadata['title']
    if (typeof t === 'string' && t.length > 0) return t
  }
  if (committedStr !== null) {
    const t = parseMdoc(committedStr).frontmatter['title']
    if (typeof t === 'string' && t.length > 0) return t
  }
  return slug
}

/** Tags from the live version: the draft's `tags` when a draft exists (even if
 *  empty — the editor may have cleared them), else the committed frontmatter's.
 *  Normalized + deduped; tolerant of absent/non-array. */
function tagsOf(draft: Draft | null, committedStr: string | null): string[] {
  if (draft) return normalizeFrom(draft.metadata['tags'])
  if (committedStr !== null) return normalizeFrom(parseMdoc(committedStr).frontmatter['tags'])
  return []
}

function normalizeFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return normalizeTags(raw.filter((x): x is string => typeof x === 'string'))
}
