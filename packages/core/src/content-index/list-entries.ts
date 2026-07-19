import type { Draft, EntryRef } from '../data/types'
import type { Lifecycle } from '../lifecycle/derive'
import { deriveLifecycle } from '../lifecycle/derive'
import { contentPath } from '../publish/content-path'
import {
  parseMdoc,
  rawFrontmatterOf,
  serializeMdoc
} from '../markdoc/frontmatter'
import { tiptapToMarkdoc } from '../markdoc/to-markdoc'
import { normalizeTags } from '../tags/normalize'
import { parseFrontmatterDate } from '../permalinks/frontmatter-date'
import { scanBody } from '../markdoc/scan-body'
import { parsePageSeoOverride } from '../seo/page-override'
import { extractMediaRefs } from './extract-media-refs'

/** Site Health content-audit facts (#593), precomputed per entry from the
 *  COMMITTED content at index time. Lives here beside {@link ContentRow} (the
 *  index-port projection re-exports it) so the content-index → index-port edge
 *  stays one-directional. */
export interface EntryAuditFacts {
  /** committed && `published !== false` — the set the audit covers (mirrors the
   *  old `loadAuditEntries` filter). The facts below only count when true. */
  audited: boolean
  /** Committed frontmatter has a non-empty `title`. */
  hasTitle: boolean
  /** Images in the committed body missing alt text. */
  imagesWithoutAlt: number
  /** `<h1>` headings in the committed body (the page template emits its own). */
  h1Count: number
}

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
  /** Frontmatter publish date (`date` ?? `pubDate`), epoch ms; null when absent. URL use only —
   *  never updatedAt/mtime (an edit must not move a URL). */
  date: number | null
  /** Normalized, deduped tags for this entry (draft's tags win when a draft exists). */
  tags: string[]
  /** Category slugs for this entry (draft's win when a draft exists). */
  categories: string[]
  /** Media keys referenced by the live version of this entry. */
  mediaRefs: string[]
  /** Featured image src from frontmatter `featuredImage` (for list/preview thumbnails). */
  featuredImage?: string
  /** Site Health content-audit facts (#593), from the COMMITTED content only —
   *  draft-blind, so it matches the old git-walk audit that never saw drafts. */
  audit: EntryAuditFacts
  /** Whether the live version has a featured image (`featuredImage` present and non-blank).
   *  Indexed so the list can show/filter the indicator without shipping the src (#576). */
  hasFeaturedImage: boolean
  /** Whether the live version's frontmatter `seo:` block sets any override (per
   *  parsePageSeoOverride — blank strings and noindex:false don't count). Indicator
   *  only: the list never ships the override VALUES (#577). */
  hasSeoOverrides: boolean
  /** Set when this entry could not be fully derived (#713/#714b): the failure message.
   *  The row is still emitted, deliberately — see the try/catch in listContentEntries.
   *  Absent on every healthy row, so `indexError !== undefined` is the only test a
   *  consumer needs. */
  indexError?: string
}

/** What the topology knows about the live deploy — server truth (#208), replacing the
 *  old `deployedAt(path) → content` lookup (which only the removed client-side deploy
 *  simulation could answer). `changed` is the `git diff --name-status` set between the
 *  deployed sha and HEAD; `added` paths have never been on the live site. */
export interface DeployInfo {
  deployedSha: string | null
  changed: { path: string; added: boolean }[]
}

/** Stand-in for "the live content differs from HEAD" when deriving lifecycle: never
 *  equal to any real committed .mdoc, and parses as non-hidden frontmatter (NUL cannot
 *  appear in a real file), so deriveLifecycle sees live-with-pending-changes. */
const MODIFIED_SINCE_DEPLOY = '\u0000modified-since-deploy'

/** The lifecycle `deployed` snapshot for a committed path, from deploy truth (#208):
 *  never deployed → null; unchanged since deploy → identical to committed (live);
 *  added since deploy → null (never on the live site → staged);
 *  modified since deploy → a value ≠ committed (live with pending changes).
 *  Shared by listContentEntries and single-entry consumers (the editor's lifecycle). */
export function deployedSnapshotFor(
  deploy: DeployInfo,
  path: string,
  committed: string | null
): string | null {
  if (deploy.deployedSha === null) return null
  const change = deploy.changed.find((c) => c.path === path)
  if (change === undefined) return committed
  return change.added ? null : MODIFIED_SINCE_DEPLOY
}

export interface ListContentEntriesInput {
  drafts: Draft[]
  committed: { ref: EntryRef; content: string }[]
  deploy: DeployInfo
}

/** A collision-proof identity key. Uses NUL (impossible in a path segment) so
 *  distinct refs can never alias even if a segment contained a slash. */
const keyOf = (r: EntryRef): string => `${r.collection}\0${r.locale}\0${r.slug}`

/** Merge DB drafts with committed Git entries into one status-aware list. The
 *  draft is the identity holder (an entry with both yields a single row). Pure —
 *  the reindex derivation; topology supplies `deploy` (server truth, #208). */
export function listContentEntries(
  input: ListContentEntriesInput
): ContentRow[] {
  const { drafts, committed, deploy } = input
  const deployedOf = (path: string, committedStr: string | null) =>
    deployedSnapshotFor(deploy, path, committedStr)

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

    // #713/#714b — BLAST RADIUS. Two derivations here throw by design, and both
    // throws are right: `tiptapToMarkdoc` refuses to silently eat an unknown
    // node/mark (#665), and `contentPath` refuses to mint a path from a
    // non-canonical segment (#670). What was wrong is that they ran unguarded
    // inside this per-entry fan-out, so ONE bad entry rejected the whole map —
    // `rebuild()`/`ensureBuilt()` threw and the admin content list rendered
    // nothing at all, losing the other N-1 healthy rows.
    //
    // Neither input is schema-validated on the way in: stored draft JSON never
    // passes through a ProseMirror schema and outlives the schema it was written
    // under (re-enable underline, or upgrade Tiptap, and old drafts start
    // failing), and `DataPort.saveDraft` does no slug validation, so a draft
    // persisted before #670 is enough. Committed content cannot reach the second
    // case — every committed `.mdoc` was swept canonical — so the exposure is
    // legacy DB drafts either way.
    //
    // The failure is therefore scoped to its own row. The row is still EMITTED,
    // carrying `indexError`: a missing row is indistinguishable from a deleted
    // entry, so dropping it would trade a loud total failure for a quiet partial
    // one — the same silent-loss class #665/#670 were closing. A row that says
    // "this entry is broken" is the only outcome the user can act on.
    let draftStr: string | null = null
    let deployed: string | null = null
    let indexError: string | undefined
    try {
      draftStr = draft
        ? serializeMdoc({
            // #666: same retention as the publish path, or a just-published entry would
            // compare unequal to its own committed file and read as pending 'edited'.
            frontmatter: draft.metadata,
            body: tiptapToMarkdoc(draft.content),
            rawFrontmatter: rawFrontmatterOf(draft.baseContent)
          })
        : null
      deployed = deployedOf(contentPath(ref), committedStr)
    } catch (err) {
      indexError = err instanceof Error ? err.message : String(err)
      // Fall back to the committed-only view: it is the honest one when the draft
      // cannot be serialized or the entry's own path cannot be minted.
      draftStr = null
      deployed = null
      // Logged as well as surfaced on the row: a skipped row nobody looks at is
      // just a slower silent loss, and the server-side index build has no UI.
      console.warn(
        `listContentEntries: ${ref.collection}/${ref.locale}/${ref.slug} could not be indexed — ${indexError}`
      )
    }

    const lifecycle = deriveLifecycle({
      draft: draftStr,
      committed: committedStr,
      deployed
    })
    const featuredImage = featuredImageOf(draft, committedStr)
    return {
      ref,
      title: titleOf(draft, committedStr, ref.slug),
      locale: ref.locale,
      lifecycle,
      updatedAt: draft ? draft.updatedAt : null,
      hasDraft: draft !== null,
      date: dateOf(draft, committedStr),
      tags: tagsOf(draft, committedStr),
      categories: categoriesOf(draft, committedStr),
      mediaRefs: mediaRefsOf(draftStr, committedStr),
      audit: auditFactsOf(committedStr),
      ...(featuredImage !== undefined ? { featuredImage } : {}),
      hasFeaturedImage: featuredImage !== undefined,
      hasSeoOverrides: hasSeoOverridesOf(draft, committedStr),
      ...(indexError !== undefined ? { indexError } : {})
    }
  })
}

const NOT_AUDITED: EntryAuditFacts = {
  audited: false,
  hasTitle: false,
  imagesWithoutAlt: 0,
  h1Count: 0
}

/** Site Health facts from the COMMITTED content (draft-blind — the old audit
 *  walked Git only). Uncommitted or `published: false` → not part of the audited
 *  set; the body is only parsed for entries that are (bounded, build-time work).
 *
 *  COLLECTION SCOPE (#593, deliberate widening): the old `loadAuditEntries` walked
 *  only `content/post` + `content/page`. This runs per index row — i.e. over EVERY
 *  content collection — so the audit now covers all committed, published content,
 *  not just post/page. That is intentional and arguably more correct: a published
 *  entry in any future collection should still be checked for a missing title /
 *  alt text / stray H1. Today post + page are the only content collections, so the
 *  offender sets are identical to the old walk (the parity test asserts this on a
 *  post/page fixture). If a non-post/page collection ever holds committed `.mdoc`,
 *  it will be audited too — by design, not by accident. */
function auditFactsOf(committedStr: string | null): EntryAuditFacts {
  if (committedStr === null) return NOT_AUDITED
  const { frontmatter, body } = parseMdoc(committedStr)
  if (frontmatter['published'] === false) return NOT_AUDITED
  const title = frontmatter['title']
  const hasTitle = typeof title === 'string' && title.trim() !== ''
  const { imagesWithoutAlt, h1Count } = scanBody(body)
  return { audited: true, hasTitle, imagesWithoutAlt, h1Count }
}

/** Featured image src from the live version's frontmatter `featuredImage` (draft's when a
 *  draft exists, else committed). Undefined when absent/blank/non-string. */
function featuredImageOf(
  draft: Draft | null,
  committedStr: string | null
): string | undefined {
  const raw = draft
    ? draft.metadata['featuredImage']
    : committedStr !== null
      ? parseMdoc(committedStr).frontmatter['featuredImage']
      : undefined
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/** Whether the live version's frontmatter sets any per-page SEO override — the same
 *  defensive `seo:` block parse the resolvers use, so "set" here means exactly "would
 *  change the rendered head". Draft's frontmatter wins when a draft exists (#577). */
function hasSeoOverridesOf(
  draft: Draft | null,
  committedStr: string | null
): boolean {
  const frontmatter = draft
    ? draft.metadata
    : committedStr !== null
      ? parseMdoc(committedStr).frontmatter
      : {}
  return Object.keys(parsePageSeoOverride(frontmatter)).length > 0
}

/** Media keys referenced by the live version (draft's serialized doc when a draft
 *  exists, else the committed file). Whole-doc scan catches body + frontmatter. */
function mediaRefsOf(
  draftStr: string | null,
  committedStr: string | null
): string[] {
  const body = draftStr ?? committedStr
  return body ? extractMediaRefs(body) : []
}

function titleOf(
  draft: Draft | null,
  committedStr: string | null,
  slug: string
): string {
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

/** Frontmatter publish date (date ?? pubDate) from the live version, epoch ms. URL use only —
 *  never updatedAt/mtime (an edit must not move a URL). Selects the live frontmatter source
 *  (draft vs. committed) here; the raw→ms parsing is shared via parseFrontmatterDate. */
function dateOf(
  draft: Draft | null,
  committedStr: string | null
): number | null {
  const frontmatter = draft
    ? draft.metadata
    : committedStr !== null
      ? parseMdoc(committedStr).frontmatter
      : {}
  return parseFrontmatterDate(frontmatter)
}

/** Tags from the live version: the draft's `tags` when a draft exists (even if
 *  empty — the editor may have cleared them), else the committed frontmatter's.
 *  Normalized + deduped; tolerant of absent/non-array. */
function tagsOf(draft: Draft | null, committedStr: string | null): string[] {
  if (draft) return normalizeFrom(draft.metadata['tags'])
  if (committedStr !== null)
    return normalizeFrom(parseMdoc(committedStr).frontmatter['tags'])
  return []
}

function normalizeFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return normalizeTags(raw.filter((x): x is string => typeof x === 'string'))
}

/** Category slugs from the live version: the draft's when a draft exists, else
 *  committed frontmatter. Slugs are already canonical (no normalization);
 *  deduped, first-seen order; tolerant of absent/non-array. */
function categoriesOf(
  draft: Draft | null,
  committedStr: string | null
): string[] {
  const raw = draft
    ? draft.metadata['categories']
    : committedStr !== null
      ? parseMdoc(committedStr).frontmatter['categories']
      : undefined
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (typeof x === 'string' && x !== '' && !seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
}
