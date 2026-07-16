import type {
  MediaIndexPort,
  MediaIndexQuery,
  MediaIndexRow,
  MediaIndexService,
  MediaRecord
} from '@setu/core'
import { mediaRowFromRecord } from '@setu/core'

/** Server-backed MediaIndexService for the admin (#464 Increment B).
 *
 *  Companion to createHttpIndexService (see its module comment for the design
 *  narrative): the server owns the media index (/api/index/media/query, kept
 *  fresh in-process by the upload/delete routes), and this service reads
 *  through it while keeping the IndexedDB media index as a stale-while-offline
 *  cache — a failed server call answers from the last-fetched rows instead.
 *
 *  - ensureBuilt/refresh/rebuild: no-ops. The server runs its own ensureBuilt
 *    before answering, and upload/delete upsert into it synchronously — there
 *    is no client-side build step left. (MediaGrid's mount-time refresh()
 *    becomes harmless: every query is already server-fresh.)
 *  - upsertOne/removeOne: cache upkeep only — the server already applied the
 *    same mutation inside the upload/delete request that triggered these.
 */
export interface HttpMediaIndexServiceDeps {
  apiBase: string
  /** apiFetch — carries the cross-origin session cookie (lib/api-fetch.ts). */
  fetchImpl: typeof fetch
  /** The IndexedDB media index port, demoted to a stale-while-offline cache. */
  mediaIndex: MediaIndexPort
}

/** Cache-meta sentinel — same role as INDEX_CACHE_VERSION on the content side:
 *  flushes a leftover locally-built media index on first use, and flags the
 *  store as a cache to any future locally-building service. */
export const MEDIA_INDEX_CACHE_VERSION = -464

export function createHttpMediaIndexService(
  deps: HttpMediaIndexServiceDeps
): MediaIndexService {
  const { apiBase, fetchImpl, mediaIndex } = deps

  let cacheReady: Promise<void> | null = null
  const ensureCache = (): Promise<void> =>
    (cacheReady ??= (async () => {
      const meta = await mediaIndex.getMeta()
      if (meta.version !== MEDIA_INDEX_CACHE_VERSION) {
        await mediaIndex.clear()
        await mediaIndex.setMeta({ version: MEDIA_INDEX_CACHE_VERSION })
      }
    })().catch((err: unknown) => {
      cacheReady = null // retry on the next touch
      throw err
    }))

  async function fetchQuery(
    q: MediaIndexQuery
  ): Promise<{ rows: MediaIndexRow[]; total: number }> {
    const params = new URLSearchParams({
      offset: String(q.offset),
      limit: String(q.limit)
    })
    if (q.q !== undefined && q.q !== '') params.set('q', q.q)
    if (q.type !== undefined) params.set('type', q.type)
    if (q.sort !== undefined) {
      params.set('sort', q.sort.key)
      params.set('dir', q.sort.dir)
    }
    const res = await fetchImpl(
      `${apiBase}/api/index/media/query?${params.toString()}`
    )
    if (!res.ok) throw new Error(`media index read failed (${res.status})`)
    const body = (await res.json()) as { rows?: unknown; total?: unknown }
    if (!Array.isArray(body.rows) || typeof body.total !== 'number')
      throw new Error('malformed media index response')
    return { rows: body.rows as MediaIndexRow[], total: body.total }
  }

  return {
    ensureBuilt: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    rebuild: () => Promise.resolve(),
    async query(q) {
      try {
        const base = await fetchQuery(q)
        // SWR cache write — a cache hiccup must never break a successful read.
        try {
          await ensureCache()
          await mediaIndex.upsertMany(base.rows)
        } catch {
          /* cache is best-effort */
        }
        return base
      } catch {
        // Server unreachable → answer from the last-fetched rows (stale, honest).
        await ensureCache()
        return mediaIndex.query(q)
      }
    },
    async upsertOne(rec: MediaRecord) {
      await ensureCache()
      await mediaIndex.upsert(mediaRowFromRecord(rec))
    },
    async removeOne(mediaKey: string) {
      await ensureCache()
      await mediaIndex.remove(mediaKey)
    }
  }
}
