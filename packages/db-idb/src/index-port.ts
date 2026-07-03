import { openDB } from 'idb'
import type { EntryIndexRow, IndexMeta, IndexPort } from '@setu/core'
import {
  runQuery,
  selectDistinctTags,
  selectDistinctLocales,
  selectCategoryCounts,
  selectTagCounts,
  selectReferencedBy,
  selectEntriesByCategory,
  selectEntriesByTag
} from '@setu/core'

/** IndexedDB-backed IndexPort. Rows are tiny (no bodies), so `query` loads the
 *  store and delegates to the shared pure `runQuery` — fast at Slice 1 scale and
 *  identical semantics to db-memory (proven by runIndexPortContract). */
export async function createIdbIndexPort(
  dbName = 'setu-index'
): Promise<IndexPort> {
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('entries')
      d.createObjectStore('meta')
    }
  })
  return {
    async query(q) {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return runQuery(all, q)
    },
    async upsert(row) {
      await db.put('entries', row, row.key)
    },
    async upsertMany(rows) {
      const tx = db.transaction('entries', 'readwrite')
      await Promise.all([...rows.map((r) => tx.store.put(r, r.key)), tx.done])
    },
    async remove(key) {
      await db.delete('entries', key)
    },
    async clear() {
      await db.clear('entries')
    },
    async getMeta() {
      return (
        ((await db.get('meta', 'meta')) as IndexMeta | undefined) ?? {
          indexedSha: null,
          version: 0
        }
      )
    },
    async setMeta(m) {
      await db.put('meta', m, 'meta')
    },
    async distinctTags(prefix, limit) {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectDistinctTags(all, prefix, limit)
    },
    async distinctLocales() {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectDistinctLocales(all)
    },
    async categoryCounts() {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectCategoryCounts(all)
    },
    async tagCounts() {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectTagCounts(all)
    },
    async referencedBy(mediaKey) {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectReferencedBy(all, mediaKey)
    },
    async entriesByCategory(slug) {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectEntriesByCategory(all, slug)
    },
    async entriesByTag(tag) {
      const all = (await db.getAll('entries')) as EntryIndexRow[]
      return selectEntriesByTag(all, tag)
    }
  }
}
