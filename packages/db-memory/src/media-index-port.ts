import type { MediaIndexRow, MediaIndexMeta, MediaIndexPort, MediaIndexQuery } from '@setu/core'
import { runMediaQuery } from '@setu/core'

export function createMemoryMediaIndexPort(): MediaIndexPort {
  const rows = new Map<string, MediaIndexRow>()
  let meta: MediaIndexMeta = { version: 0 }
  return {
    async query(q: MediaIndexQuery) { return runMediaQuery([...rows.values()], q) },
    async upsert(row) { rows.set(row.mediaKey, structuredClone(row)) },
    async upsertMany(rs) { for (const r of rs) rows.set(r.mediaKey, structuredClone(r)) },
    async remove(mediaKey) { rows.delete(mediaKey) },
    async clear() { rows.clear() },
    async getMeta() { return { ...meta } },
    async setMeta(m) { meta = { ...m } },
  }
}
