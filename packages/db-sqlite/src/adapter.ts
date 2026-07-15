import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { DataPort, Draft, EntryRef, Lock } from '@setu/core'
import { drafts, locks } from './schema'

// Path is relative to the SOURCE file (this package runs from src, no build step).
// If a build step emitting to dist/ is ever added, adjust this traversal.
const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle'
)

type DraftRow = typeof drafts.$inferSelect

const rowToDraft = (r: DraftRow): Draft => ({
  collection: r.collection,
  locale: r.locale,
  slug: r.slug,
  content: JSON.parse(r.content) as Draft['content'],
  metadata: JSON.parse(r.metadata) as Record<string, unknown>,
  baseSha: r.baseSha,
  baseContent: r.baseContent,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt
})

type LockRow = typeof locks.$inferSelect

const rowToLock = (r: LockRow): Lock => ({
  collection: r.collection,
  locale: r.locale,
  slug: r.slug,
  lockedBy: r.lockedBy,
  lockedAt: r.lockedAt
})

/** Create a better-sqlite3-backed DataPort. `file` is a path or ':memory:'. */
export function createSqliteAdapter(file: string): DataPort {
  const sqlite = new Database(file)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })

  const whereDraft = (ref: EntryRef) =>
    and(
      eq(drafts.collection, ref.collection),
      eq(drafts.locale, ref.locale),
      eq(drafts.slug, ref.slug)
    )
  const whereLock = (ref: EntryRef) =>
    and(
      eq(locks.collection, ref.collection),
      eq(locks.locale, ref.locale),
      eq(locks.slug, ref.slug)
    )

  const readDraft = (ref: EntryRef): Draft | null => {
    const row = db.select().from(drafts).where(whereDraft(ref)).get()
    return row ? rowToDraft(row) : null
  }

  return {
    async getDraft(ref) {
      return readDraft(ref)
    },
    async saveDraft(input) {
      const now = Date.now()
      const content = JSON.stringify(input.content)
      const metadata = JSON.stringify(input.metadata)
      const baseSha = input.baseSha ?? null
      db.insert(drafts)
        .values({
          collection: input.collection,
          locale: input.locale,
          slug: input.slug,
          content,
          metadata,
          baseSha,
          baseContent: input.baseContent ?? null,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [drafts.collection, drafts.locale, drafts.slug],
          set: {
            content,
            metadata,
            baseSha,
            updatedAt: now,
            // Omitted baseContent PRESERVES the stored fork point (#261) —
            // only an explicit value (including null) overwrites it.
            ...(input.baseContent !== undefined
              ? { baseContent: input.baseContent }
              : {})
          }
        })
        .run()
      // Re-read to return the canonical row: ON CONFLICT DO UPDATE preserves the
      // original createdAt, which is not in scope here (local `now` is the new time).
      return readDraft(input)!
    },
    async deleteDraft(ref) {
      db.delete(drafts).where(whereDraft(ref)).run()
    },
    async listDrafts(filter) {
      const rows = filter?.collection
        ? db
            .select()
            .from(drafts)
            .where(eq(drafts.collection, filter.collection))
            .all()
        : db.select().from(drafts).all()
      return rows.map(rowToDraft)
    },
    async getLock(ref) {
      const row = db.select().from(locks).where(whereLock(ref)).get()
      return row ? rowToLock(row) : null
    },
    async putLock(lock) {
      db.insert(locks)
        .values({
          collection: lock.collection,
          locale: lock.locale,
          slug: lock.slug,
          lockedBy: lock.lockedBy,
          lockedAt: lock.lockedAt
        })
        .onConflictDoUpdate({
          target: [locks.collection, locks.locale, locks.slug],
          set: { lockedBy: lock.lockedBy, lockedAt: lock.lockedAt }
        })
        .run()
    },
    async deleteLock(ref) {
      db.delete(locks).where(whereLock(ref)).run()
    },
    async close() {
      sqlite.close()
    }
  }
}
