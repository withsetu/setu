import { openDB } from 'idb'
import type { MediaIndexRow, MediaIndexMeta, MediaIndexPort } from '@setu/core'
import { runMediaQuery } from '@setu/core'

/** IndexedDB-backed MediaIndexPort. Own DB (no version coordination with the
 *  content index). Rows are tiny; query loads the store + delegates to the shared
 *  pure runMediaQuery (same pattern as createIdbIndexPort). */
export async function createIdbMediaIndexPort(dbName = 'setu-media-index'): Promise<MediaIndexPort> {
  const db = await openDB(dbName, 1, {
    upgrade(d) { d.createObjectStore('media'); d.createObjectStore('meta') },
  })
  return {
    async query(q) { return runMediaQuery((await db.getAll('media')) as MediaIndexRow[], q) },
    async upsert(row) { await db.put('media', row, row.mediaKey) },
    async upsertMany(rows) {
      const tx = db.transaction('media', 'readwrite')
      await Promise.all([...rows.map((r) => tx.store.put(r, r.mediaKey)), tx.done])
    },
    async remove(mediaKey) { await db.delete('media', mediaKey) },
    async clear() { await db.clear('media') },
    async getMeta() { return ((await db.get('meta', 'meta')) as MediaIndexMeta | undefined) ?? { version: 0 } },
    async setMeta(m) { await db.put('meta', m, 'meta') },
  }
}
