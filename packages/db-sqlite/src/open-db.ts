import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../drizzle')

/** Open (and migrate) a drizzle handle over `file` (a path or ':memory:'),
 *  running the same migrations `createSqliteAdapter`/`createSqliteSubmissionPort`
 *  use. This is the shared seam for callers (e.g. `@setu/auth`'s `createAuth`)
 *  that need a raw drizzle handle over the same sqlite file as a DataPort/
 *  SubmissionPort adapter, without duplicating adapter construction. */
export function openSqliteDb(file: string): BetterSQLite3Database {
  const sqlite = new Database(file)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })
  return db
}
