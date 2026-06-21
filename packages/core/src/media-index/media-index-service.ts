import type { MediaIndexPort, MediaIndexQuery, MediaRecord } from './types'
import { mediaRowFromRecord } from './types'

export const MEDIA_INDEX_VERSION = 1

export interface MediaIndexService {
  ensureBuilt(): Promise<void>
  refresh(): Promise<void>
  rebuild(): Promise<void>
  query(q: MediaIndexQuery): Promise<{ rows: import('./types').MediaIndexRow[]; total: number }>
  upsertOne(rec: MediaRecord): Promise<void>
  removeOne(mediaKey: string): Promise<void>
}

export interface MediaIndexServiceDeps {
  mediaIndex: MediaIndexPort
  fetchRaw: () => Promise<MediaRecord[]>
}

export function createMediaIndexService({ mediaIndex, fetchRaw }: MediaIndexServiceDeps): MediaIndexService {
  async function rebuild(): Promise<void> {
    const recs = await fetchRaw()
    await mediaIndex.clear()
    await mediaIndex.upsertMany(recs.map(mediaRowFromRecord))
    await mediaIndex.setMeta({ version: MEDIA_INDEX_VERSION })
  }
  async function ensureBuilt(): Promise<void> {
    const meta = await mediaIndex.getMeta()
    if (meta.version !== MEDIA_INDEX_VERSION) await rebuild()
  }
  return {
    ensureBuilt,
    rebuild,
    refresh: rebuild, // stale-while-revalidate: callers render cached rows first, then refresh()
    async query(q) { return mediaIndex.query(q) },
    async upsertOne(rec) { await mediaIndex.upsert(mediaRowFromRecord(rec)) },
    async removeOne(mediaKey) { await mediaIndex.remove(mediaKey) },
  }
}
