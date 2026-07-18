import type {
  ContentRow,
  DataPort,
  DeployInfo,
  Draft,
  EntryRef,
  GitPort,
  IndexPort,
  IndexQuery,
  IndexService,
  IndexStats,
  MediaUsage
} from '@setu/core'
import {
  contentPath,
  indexKey,
  listContentEntries,
  normalizeTags,
  projectRow,
  rowToContentRow,
  runQuery
} from '@setu/core'

/** Server-backed IndexService for the admin (#464 Increment B).
 *
 *  When the admin runs against an API, the server owns the content index
 *  (/api/index/*, built from the real repo + deploy truth). This service reads
 *  through those routes while presenting the exact IndexService surface every
 *  `useIndex()` consumer already speaks, so swapping it in is a wiring-only
 *  change. It lives in the admin (not core) because it composes three
 *  admin-topology concerns core stays agnostic of: the credentialed apiFetch,
 *  the IndexedDB offline cache, and this browser's local drafts.
 *
 *  Three deliberate semantics, in order of importance:
 *
 *  1. LOCAL-DRAFT OVERLAY. Drafts autosave into this browser's IndexedDB — the
 *     server cannot know them. After every read the local DataPort's drafts are
 *     merged in with core's own derivation (`listContentEntries` over the
 *     draft + the committed file + deploy truth — never a forked lifecycle
 *     approximation). A draft can only change `pending`, never `state` (see
 *     deriveLifecycle), so status-filter membership is stable; a draft's
 *     tags/categories/title CAN change filter membership, and the overlay
 *     re-decides that only for rows on the returned page — a drafted entry
 *     living on ANOTHER page keeps the server's (draft-blind) placement. That
 *     approximation is the price of server-side pagination and is accepted.
 *
 *  2. LOCAL-ONLY DRAFTS (never committed — the server has no row at all) are
 *     injected at the top of the FIRST page when they match the query, and
 *     counted in `total` on every page so the pager stays consistent. Top
 *     placement matches the browser-built index's practical behavior: fresh
 *     drafts have the newest updatedAt and the default sort is updatedAt desc.
 *
 *  3. STALE-WHILE-OFFLINE CACHE. Every fetched page is upserted into the
 *     existing IndexedDB IndexPort. When the server call fails, the query is
 *     answered from those cached rows instead (then draft-overlaid as usual).
 *     The cache is additive — rows deleted on the server can linger until the
 *     next successful fetch overwrites the picture — visible staleness the
 *     UI already tolerates, traded for a list that still paints offline.
 *
 *  Write-side bookkeeping maps to the server owning index state:
 *  - ensureBuilt/markSyncedAt: no-ops — the server runs ensureBuilt before
 *    answering every /api/index request and owns the indexedSha bookkeeping.
 *  - reindexEntry: re-derives the one entry into the offline cache so the
 *    fallback picture stays fresh right after a publish/bulk commit (the
 *    server already refreshed itself via its post-commit hook).
 *  - reindexAfterDeploy/rebuild: POST /api/index/refresh — a deploy that does
 *    not move git HEAD only changes deploy-derived lifecycle, which the
 *    server's sha-compare cannot see without being asked.
 */
export interface HttpIndexServiceDeps {
  apiBase: string
  /** apiFetch — carries the cross-origin session cookie (lib/api-fetch.ts). */
  fetchImpl: typeof fetch
  /** Local drafts (IndexedDB) — the overlay source. */
  data: DataPort
  /** Committed reads for overlay derivation (the HTTP GitPort). */
  git: GitPort
  /** The IndexedDB index port, demoted to a stale-while-offline cache. */
  index: IndexPort
  /** Client-side deploy truth (useDeploy) for overlay lifecycle derivation. */
  deploy: () => DeployInfo
}

/** Mirrors apps/api/src/index-api.ts MAX_LIMIT — larger asks are paged. */
export const SERVER_PAGE_LIMIT = 100

/** Cache-meta sentinel. Never a real INDEX_VERSION, so (a) a leftover
 *  locally-built index is flushed the first time this service touches the
 *  cache, and (b) if the topology ever flips back to the browser-built index,
 *  its ensureBuilt sees a version mismatch and rebuilds over the cache.
 *  -576: row shape gained the indicator booleans (#576/#577) — new sentinel
 *  flushes cached rows that predate them. */
export const INDEX_CACHE_VERSION = -576

const NO_DEPLOY: DeployInfo = { deployedSha: null, changed: [] }

export function createHttpIndexService(
  deps: HttpIndexServiceDeps
): IndexService {
  const { apiBase, fetchImpl, data, git, index, deploy } = deps

  // --- offline cache -------------------------------------------------------
  let cacheReady: Promise<void> | null = null
  const ensureCache = (): Promise<void> =>
    (cacheReady ??= (async () => {
      const meta = await index.getMeta()
      if (meta.version !== INDEX_CACHE_VERSION) {
        await index.clear()
        await index.setMeta({ indexedSha: null, version: INDEX_CACHE_VERSION })
      }
    })().catch((err: unknown) => {
      cacheReady = null // retry on the next touch
      throw err
    }))

  // --- server reads --------------------------------------------------------
  async function getJson<T>(path: string, params: URLSearchParams): Promise<T> {
    const res = await fetchImpl(`${apiBase}${path}?${params.toString()}`)
    if (!res.ok) throw new Error(`index read failed (${res.status})`)
    return (await res.json()) as T
  }

  function queryParams(q: IndexQuery): URLSearchParams {
    const params = new URLSearchParams({
      collection: q.collection,
      offset: String(q.offset),
      limit: String(q.limit)
    })
    if (q.q !== undefined && q.q !== '') params.set('q', q.q)
    if (q.status !== undefined) params.set('status', q.status)
    if (q.locale !== undefined && q.locale !== '')
      params.set('locale', q.locale)
    if (q.tag !== undefined && q.tag !== '') params.set('tag', q.tag)
    if (q.category !== undefined && q.category !== '')
      params.set('category', q.category)
    if (q.hasFeaturedImage !== undefined)
      params.set('hasFeaturedImage', String(q.hasFeaturedImage))
    if (q.hasSeoOverrides !== undefined)
      params.set('hasSeoOverrides', String(q.hasSeoOverrides))
    if (q.sort !== undefined) {
      params.set('sort', q.sort.key)
      params.set('dir', q.sort.dir)
    }
    return params
  }

  async function fetchQueryOnce(
    q: IndexQuery
  ): Promise<{ rows: ContentRow[]; total: number }> {
    const body = await getJson<{ rows?: unknown; total?: unknown }>(
      '/api/index/query',
      queryParams(q)
    )
    if (!Array.isArray(body.rows) || typeof body.total !== 'number')
      throw new Error('malformed index response')
    return { rows: body.rows as ContentRow[], total: body.total }
  }

  /** The server rejects limit > 100 (fail-loud Zod bound); some consumers ask
   *  for more (ReadingSettings' page picker asks for 1000), so page through. */
  async function fetchQueryPaged(
    q: IndexQuery
  ): Promise<{ rows: ContentRow[]; total: number }> {
    if (q.limit <= SERVER_PAGE_LIMIT) return fetchQueryOnce(q)
    const rows: ContentRow[] = []
    let total = 0
    let offset = q.offset
    while (rows.length < q.limit) {
      const page = await fetchQueryOnce({
        ...q,
        offset,
        limit: SERVER_PAGE_LIMIT
      })
      rows.push(...page.rows)
      total = page.total
      offset += page.rows.length
      if (page.rows.length === 0 || offset >= total) break
    }
    return { rows: rows.slice(0, q.limit), total }
  }

  // --- local-draft overlay -------------------------------------------------

  /** Core's own derivation for one drafted entry: draft + committed (read from
   *  the git seam, exactly like core's reindexEntry) + deploy truth. */
  async function deriveDraftRow(
    d: Draft,
    committed: string | null
  ): Promise<ContentRow> {
    const ref: EntryRef = {
      collection: d.collection,
      locale: d.locale,
      slug: d.slug
    }
    return listContentEntries({
      drafts: [d],
      committed: committed !== null ? [{ ref, content: committed }] : [],
      deploy: deploy()
    })[0]!
  }

  /** Pure draft-only derivation (no git read, no deploy): used where only the
   *  draft's OWN fields matter (tags/categories/mediaRefs/title all come from
   *  the draft whenever a draft exists — see listContentEntries). */
  function draftOwnRow(d: Draft): ContentRow {
    return listContentEntries({
      drafts: [d],
      committed: [],
      deploy: NO_DEPLOY
    })[0]!
  }

  const matchesQuery = (row: ContentRow, q: IndexQuery): boolean =>
    runQuery([projectRow(row)], { ...q, offset: 0, limit: 1 }).total === 1

  async function overlayDrafts(
    q: IndexQuery,
    base: { rows: ContentRow[]; total: number }
  ): Promise<{ rows: ContentRow[]; total: number }> {
    const drafts = await data.listDrafts({ collection: q.collection })
    if (drafts.length === 0) return base
    const rows = [...base.rows]
    let total = base.total
    const posByKey = new Map(rows.map((r, i) => [indexKey(r.ref), i]))
    const removed = new Set<number>()
    const extras: ContentRow[] = []
    for (const d of drafts) {
      const ref: EntryRef = {
        collection: d.collection,
        locale: d.locale,
        slug: d.slug
      }
      const pos = posByKey.get(indexKey(ref))
      let committed: string | null
      try {
        committed = await git.readFile(contentPath(ref))
      } catch {
        // Committed copy unreadable (network flake mid-overlay): never GUESS a
        // lifecycle without the committed snapshot — surface the draft's
        // existence on an already-listed row and otherwise leave things alone.
        if (pos !== undefined) {
          rows[pos] = { ...rows[pos]!, hasDraft: true, updatedAt: d.updatedAt }
        }
        continue
      }
      const derived = await deriveDraftRow(d, committed)
      const matches = matchesQuery(derived, q)
      if (pos !== undefined) {
        // The server listed it (judged draft-blind); the draft may change
        // tag/category/title membership → re-decide, in place.
        if (matches) rows[pos] = derived
        else {
          removed.add(pos)
          total -= 1
        }
      } else if (committed === null && matches) {
        // Local-only draft: the server has never seen it. Injected on the
        // first page only (pages > 0 must not duplicate it); counted in
        // `total` on every page so the pager stays consistent.
        extras.push(derived)
        total += 1
      }
      // committed !== null && pos === undefined: the entry lives on another
      // server page (or was filtered out server-side). Left alone — see the
      // module comment on the accepted pagination approximation.
    }
    const kept = rows.filter((_, i) => !removed.has(i))
    if (q.offset === 0 && extras.length > 0) {
      // Order the injected drafts among themselves with the query's own
      // comparator (runQuery is the single sort impl shared by adapters).
      const sortedExtras = runQuery(extras.map(projectRow), {
        collection: q.collection,
        offset: 0,
        limit: extras.length,
        ...(q.sort !== undefined ? { sort: q.sort } : {})
      }).rows.map(rowToContentRow)
      return { rows: [...sortedExtras, ...kept], total }
    }
    return { rows: kept, total }
  }

  // --- IndexService surface --------------------------------------------------

  async function query(
    q: IndexQuery
  ): Promise<{ rows: ContentRow[]; total: number }> {
    let base: { rows: ContentRow[]; total: number }
    try {
      base = await fetchQueryPaged(q)
      // SWR cache write — a cache hiccup must never break a successful read.
      try {
        await ensureCache()
        await index.upsertMany(base.rows.map(projectRow))
      } catch {
        /* cache is best-effort */
      }
    } catch {
      // Server unreachable → answer from the last-fetched rows (stale, honest).
      await ensureCache()
      const cached = await index.query(q)
      base = { rows: cached.rows.map(rowToContentRow), total: cached.total }
    }
    return overlayDrafts(q, base)
  }

  // Dashboard At-a-glance counts (#587). Server truth (committed content +
  // deploy-derived lifecycle) — NO draft overlay, and that is DELIBERATE
  // (owner-approved 2026-07-17): dashboard counts = committed / site truth;
  // local uncommitted browser drafts (autosave scratch) are intentionally not
  // counted. They still appear in "Resume editing" (this browser's personal
  // recent work) via query()'s draft overlay — just not in the totals.
  // WordPress-aligned: autosave doesn't bump the Drafts count, a real Save
  // Draft does — and Setu's Save Draft commits to git, so it still counts.
  // (Same no-overlay stance as categoryCounts/tagCounts below.) Offline → the
  // stale-while-offline cache answers.
  async function stats(): Promise<IndexStats> {
    try {
      return await getJson<IndexStats>(
        '/api/index/stats',
        new URLSearchParams()
      )
    } catch {
      await ensureCache()
      return index.stats()
    }
  }

  interface Facets {
    distinctTags: string[]
    distinctLocales: string[]
    categoryCounts: Record<string, number>
    tagCounts: Record<string, number>
  }
  const fetchFacets = (tagPrefix: string, tagLimit: number): Promise<Facets> =>
    getJson<Facets>(
      '/api/index/facets',
      new URLSearchParams({ tagPrefix, tagLimit: String(tagLimit) })
    )

  /** Normalized tags of one draft — same normalizeTags core's tagsOf applies. */
  function draftTags(d: Draft): string[] {
    const raw = d.metadata['tags']
    if (!Array.isArray(raw)) return []
    return normalizeTags(raw.filter((x): x is string => typeof x === 'string'))
  }

  async function distinctTags(
    prefix: string,
    limit: number
  ): Promise<string[]> {
    let server: string[]
    try {
      server = (await fetchFacets(prefix, limit)).distinctTags
    } catch {
      await ensureCache()
      server = await index.distinctTags(prefix, limit)
    }
    // Union this browser's draft tags — the server can't see local drafts, and
    // the browser-built index included them (type-ahead must offer a tag you
    // just typed into a draft). Same prefix semantics as selectDistinctTags.
    const p = prefix.toLowerCase().trim()
    const out = new Set(server)
    for (const d of await data.listDrafts())
      for (const t of draftTags(d)) if (t.startsWith(p)) out.add(t)
    return [...out].sort().slice(0, limit)
  }

  async function distinctLocales(): Promise<string[]> {
    let server: string[]
    try {
      server = (await fetchFacets('', 1)).distinctLocales
    } catch {
      await ensureCache()
      server = await index.distinctLocales()
    }
    const out = new Set(server)
    for (const d of await data.listDrafts()) out.add(d.locale)
    return [...out].sort()
  }

  // Counts are server truth (committed content) — no draft overlay: counting
  // drafts correctly would need the committed tag set of every drafted entry
  // to diff against, and the pickers these feed only need the vocabulary
  // (which distinctTags overlays above). Documented deviation from the
  // browser-built index, which counted draft tags too.
  async function categoryCounts(): Promise<Record<string, number>> {
    try {
      return (await fetchFacets('', 1)).categoryCounts
    } catch {
      await ensureCache()
      return index.categoryCounts()
    }
  }

  async function tagCounts(): Promise<Record<string, number>> {
    try {
      return (await fetchFacets('', 1)).tagCounts
    } catch {
      await ensureCache()
      return index.tagCounts()
    }
  }

  async function referencedBy(mediaKey: string): Promise<MediaUsage[]> {
    let server: MediaUsage[]
    try {
      server = await getJson<MediaUsage[]>(
        '/api/index/referenced-by',
        new URLSearchParams({ mediaKey })
      )
    } catch {
      await ensureCache()
      server = await index.referencedBy(mediaKey)
    }
    // Draft content wins wholesale (mediaRefs come from the draft whenever a
    // draft exists — core's mediaRefsOf): a draft that dropped the reference
    // removes the server usage; a draft that added it contributes one.
    const keyOf = (u: { collection: string; locale: string; slug: string }) =>
      indexKey(u)
    const byKey = new Map(server.map((u) => [keyOf(u), u]))
    for (const d of await data.listDrafts()) {
      const row = draftOwnRow(d)
      if (row.mediaRefs.includes(mediaKey))
        byKey.set(keyOf(row.ref), { ...row.ref, title: row.title })
      else byKey.delete(keyOf(row.ref))
    }
    return [...byKey.values()]
  }

  /** Shared shape for entriesByTag/entriesByCategory: server refs, then draft
   *  membership wins for drafted entries (add or remove). */
  async function overlayRefs(
    server: EntryRef[],
    draftHas: (d: Draft) => boolean
  ): Promise<EntryRef[]> {
    const byKey = new Map(server.map((r) => [indexKey(r), r]))
    for (const d of await data.listDrafts()) {
      const ref: EntryRef = {
        collection: d.collection,
        locale: d.locale,
        slug: d.slug
      }
      if (draftHas(d)) byKey.set(indexKey(ref), ref)
      else byKey.delete(indexKey(ref))
    }
    return [...byKey.values()]
  }

  async function entriesByTag(tag: string): Promise<EntryRef[]> {
    let server: EntryRef[]
    try {
      server = await getJson<EntryRef[]>(
        '/api/index/entries-by-tag',
        new URLSearchParams({ tag })
      )
    } catch {
      await ensureCache()
      server = await index.entriesByTag(tag)
    }
    return overlayRefs(server, (d) => draftTags(d).includes(tag))
  }

  async function entriesByCategory(slug: string): Promise<EntryRef[]> {
    let server: EntryRef[]
    try {
      server = await getJson<EntryRef[]>(
        '/api/index/entries-by-category',
        new URLSearchParams({ slug })
      )
    } catch {
      await ensureCache()
      server = await index.entriesByCategory(slug)
    }
    return overlayRefs(server, (d) => draftOwnRow(d).categories.includes(slug))
  }

  async function reindexEntry(ref: EntryRef): Promise<void> {
    // The SERVER already re-derived this entry (post-commit hook + per-request
    // ensureBuilt); this keeps the OFFLINE CACHE fresh so a network drop right
    // after a publish still paints the new status.
    const committed = await git.readFile(contentPath(ref))
    const draft = await data.getDraft(ref)
    const rows = listContentEntries({
      drafts: draft !== null ? [draft] : [],
      committed: committed !== null ? [{ ref, content: committed }] : [],
      deploy: deploy()
    })
    await ensureCache()
    if (rows.length === 0) await index.remove(indexKey(ref))
    else await index.upsert(projectRow(rows[0]!))
  }

  async function refreshServer(): Promise<void> {
    const res = await fetchImpl(`${apiBase}/api/index/refresh`, {
      method: 'POST'
    })
    if (!res.ok) throw new Error(`index refresh failed (${res.status})`)
  }

  return {
    // The server runs its own ensureBuilt before answering every /api/index
    // request — there is nothing to build client-side. Queries surface their
    // own failures; IndexProvider's boot-time call is a cheap resolved no-op.
    ensureBuilt: () => Promise.resolve(),
    // rebuild == "force a re-derivation" — the server-side one.
    rebuild: refreshServer,
    reindexEntry,
    // Deploy-derived lifecycle (staged→live) changes without a HEAD move; the
    // server can't see that from sha-compares, so ask it to re-derive.
    reindexAfterDeploy: refreshServer,
    // indexedSha bookkeeping belongs to the server's own index now.
    markSyncedAt: () => Promise.resolve(),
    query,
    stats,
    distinctTags,
    distinctLocales,
    categoryCounts,
    tagCounts,
    referencedBy,
    entriesByCategory,
    entriesByTag
  }
}
