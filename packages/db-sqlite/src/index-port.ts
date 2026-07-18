import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { EntryIndexRow, IndexMeta, IndexPort } from '@setu/core'
import {
  runQuery,
  selectIndexStats,
  selectDistinctTags,
  selectDistinctLocales,
  selectCategoryCounts,
  selectTagCounts,
  selectReferencedBy,
  selectEntriesByCategory,
  selectEntriesByTag,
  selectAuditSummary
} from '@setu/core'
import { entryIndex, indexMeta } from './schema'

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle'
)

const META_SCOPE = 'entry'

/** better-sqlite3-backed IndexPort (#464). Deliberate v1: rows are stored as
 *  opaque JSON keyed by identity; every read loads the (tiny, body-free) rows
 *  and delegates filtering/sorting/facets to the SAME shared pure helpers
 *  db-idb uses, so contract semantics match by construction. SQL-native
 *  querying/FTS5 is deferred to #205. `file` is a path or ':memory:'. */
export function createSqliteIndexPort(file: string): IndexPort {
  const sqlite = new Database(file)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })

  const loadAll = (): EntryIndexRow[] =>
    db
      .select()
      .from(entryIndex)
      .all()
      .map((r) => JSON.parse(r.row) as EntryIndexRow)

  const put = (row: EntryIndexRow): void => {
    const json = JSON.stringify(row)
    db.insert(entryIndex)
      .values({ key: row.key, row: json })
      .onConflictDoUpdate({ target: entryIndex.key, set: { row: json } })
      .run()
  }

  return {
    async query(q) {
      return runQuery(loadAll(), q)
    },
    // v1: one body-free scan tallied in JS — already O(rows) with no HTTP, a
    // massive win over the dashboard's old fetch-every-body path (#587). The
    // #205/#588 optimization is a SQL COUNT/GROUP BY over indexed
    // collection+status columns, same return shape, faster internals.
    async stats() {
      return selectIndexStats(loadAll())
    },
    async upsert(row) {
      put(row)
    },
    async upsertMany(rows) {
      db.transaction(() => {
        for (const r of rows) put(r)
      })
    },
    async remove(key) {
      db.delete(entryIndex).where(eq(entryIndex.key, key)).run()
    },
    async clear() {
      db.delete(entryIndex).run()
    },
    async getMeta() {
      const row = db
        .select()
        .from(indexMeta)
        .where(eq(indexMeta.scope, META_SCOPE))
        .get()
      return row
        ? (JSON.parse(row.meta) as IndexMeta)
        : { indexedSha: null, version: 0 }
    },
    async setMeta(m) {
      const json = JSON.stringify(m)
      db.insert(indexMeta)
        .values({ scope: META_SCOPE, meta: json })
        .onConflictDoUpdate({ target: indexMeta.scope, set: { meta: json } })
        .run()
    },
    async distinctTags(prefix, limit) {
      return selectDistinctTags(loadAll(), prefix, limit)
    },
    async distinctLocales() {
      return selectDistinctLocales(loadAll())
    },
    async categoryCounts() {
      return selectCategoryCounts(loadAll())
    },
    async tagCounts() {
      return selectTagCounts(loadAll())
    },
    async referencedBy(mediaKey) {
      return selectReferencedBy(loadAll(), mediaKey)
    },
    async entriesByCategory(slug) {
      return selectEntriesByCategory(loadAll(), slug)
    },
    async entriesByTag(tag) {
      return selectEntriesByTag(loadAll(), tag)
    },
    async auditSummary() {
      return selectAuditSummary(loadAll())
    }
  }
}
