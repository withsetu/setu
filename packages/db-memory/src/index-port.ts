import type { EntryIndexRow, IndexMeta, IndexPort, IndexQuery } from '@setu/core'
import { runQuery, selectDistinctTags, selectDistinctLocales, selectCategoryCounts, selectReferencedBy } from '@setu/core'

/** In-memory IndexPort (Map-backed). Value semantics via structuredClone. */
export function createMemoryIndexPort(): IndexPort {
  const rows = new Map<string, EntryIndexRow>()
  let meta: IndexMeta = { indexedSha: null, version: 0 }
  return {
    async query(q: IndexQuery) {
      return runQuery([...rows.values()], q)
    },
    async upsert(row) {
      rows.set(row.key, structuredClone(row))
    },
    async upsertMany(rs) {
      for (const r of rs) rows.set(r.key, structuredClone(r))
    },
    async remove(key) {
      rows.delete(key)
    },
    async clear() {
      rows.clear()
    },
    async getMeta() {
      return { ...meta }
    },
    async setMeta(m) {
      meta = { ...m }
    },
    async distinctTags(prefix, limit) {
      return selectDistinctTags([...rows.values()], prefix, limit)
    },
    async distinctLocales() {
      return selectDistinctLocales([...rows.values()])
    },
    async categoryCounts() {
      return selectCategoryCounts([...rows.values()])
    },
    async referencedBy(mediaKey) { return selectReferencedBy([...rows.values()], mediaKey) },
  }
}
