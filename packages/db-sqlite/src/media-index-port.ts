import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { MediaIndexMeta, MediaIndexPort, MediaIndexRow } from '@setu/core'
import { runMediaQuery } from '@setu/core'
import { mediaIndex, indexMeta } from './schema'

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle'
)

const META_SCOPE = 'media'

/** better-sqlite3-backed MediaIndexPort (#464). Same deliberate v1 shape as
 *  createSqliteIndexPort: JSON rows keyed by mediaKey, reads load-all and
 *  delegate to the shared pure `runMediaQuery` (SQL-native querying deferred to
 *  #205). `file` is a path or ':memory:'.
 *
 *  Sharing `runMediaQuery` is not on its own enough to match db-idb: until #897
 *  gave it a total order, tied rows fell through to each adapter's storage order
 *  and the three adapters returned different pages for identical data — which is
 *  exactly what disproved this comment's original "identical semantics by
 *  construction" (#898). Parity is enforced by the shared MediaIndexPort
 *  contract in packages/db-testing/src/index.ts, run against db-sqlite,
 *  db-memory and db-idb. */
export function createSqliteMediaIndexPort(file: string): MediaIndexPort {
  const sqlite = new Database(file)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })

  const loadAll = (): MediaIndexRow[] =>
    db
      .select()
      .from(mediaIndex)
      .all()
      .map((r) => JSON.parse(r.row) as MediaIndexRow)

  const put = (row: MediaIndexRow): void => {
    const json = JSON.stringify(row)
    db.insert(mediaIndex)
      .values({ mediaKey: row.mediaKey, row: json })
      .onConflictDoUpdate({ target: mediaIndex.mediaKey, set: { row: json } })
      .run()
  }

  return {
    async query(q) {
      return runMediaQuery(loadAll(), q)
    },
    async upsert(row) {
      put(row)
    },
    async upsertMany(rows) {
      db.transaction(() => {
        for (const r of rows) put(r)
      })
    },
    async remove(mediaKey) {
      db.delete(mediaIndex).where(eq(mediaIndex.mediaKey, mediaKey)).run()
    },
    async clear() {
      db.delete(mediaIndex).run()
    },
    async getMeta() {
      const row = db
        .select()
        .from(indexMeta)
        .where(eq(indexMeta.scope, META_SCOPE))
        .get()
      return row ? (JSON.parse(row.meta) as MediaIndexMeta) : { version: 0 }
    },
    async setMeta(m) {
      const json = JSON.stringify(m)
      db.insert(indexMeta)
        .values({ scope: META_SCOPE, meta: json })
        .onConflictDoUpdate({ target: indexMeta.scope, set: { meta: json } })
        .run()
    }
  }
}
