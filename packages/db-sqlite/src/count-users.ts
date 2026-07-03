import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { user } from './schema'

/** Row count of the `user` table (Better Auth's table, defined in ./schema). Used by capabilities'
 *  `needsSetup` — a fresh install has zero users, so the admin should be routed to first-run setup
 *  rather than a sign-in form. Cheap single-purpose COUNT query, same select-count pattern as
 *  submission-port.ts's listSubmissions total. */
export function countUsers(db: BetterSQLite3Database): number {
  const row = db.select({ n: sql<number>`count(*)` }).from(user).get()
  return row?.n ?? 0
}
