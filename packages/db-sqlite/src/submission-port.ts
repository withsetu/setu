import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { and, desc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { SubmissionPort, Submission, SubmissionInput } from '@setu/core'
import { selectDistinctForms } from '@setu/core'
import { submissions } from './schema'

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle'
)

type Row = typeof submissions.$inferSelect

const rowToSubmission = (r: Row): Submission => {
  // Absence is `null` (the column default), not falsiness (#897): testing these
  // for truthiness dropped an empty-string `referrer`, which is the NORMAL value
  // for a direct visit, so db-memory kept a field db-sqlite silently lost. The one
  // case the columns genuinely cannot represent is a source object whose every
  // field is absent — it reads back as no source at all.
  // Enforced by the source round-trip case in packages/db-testing/src/index.ts.
  const source =
    r.sourceUrl !== null ||
    r.sourceReferrer !== null ||
    r.sourceUserAgent !== null
      ? {
          ...(r.sourceUrl !== null ? { url: r.sourceUrl } : {}),
          ...(r.sourceReferrer !== null ? { referrer: r.sourceReferrer } : {}),
          ...(r.sourceUserAgent !== null
            ? { userAgent: r.sourceUserAgent }
            : {})
        }
      : undefined
  return {
    id: r.id,
    formId: r.formId,
    formLabel: r.formLabel ?? undefined,
    fields: JSON.parse(r.fields) as Record<string, string>,
    createdAt: r.createdAt,
    read: r.read === 1,
    ...(source ? { source } : {})
  }
}

/** Create a better-sqlite3-backed SubmissionPort. `file` is a path or ':memory:'. */
export function createSqliteSubmissionPort(file: string): SubmissionPort {
  const sqlite = new Database(file)
  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })

  const read = (id: string): Submission | null => {
    const row = db
      .select()
      .from(submissions)
      .where(eq(submissions.id, id))
      .get()
    return row ? rowToSubmission(row) : null
  }

  return {
    async saveSubmission(input: SubmissionInput) {
      const id = crypto.randomUUID()
      db.insert(submissions)
        .values({
          id,
          formId: input.formId,
          formLabel: input.formLabel ?? null,
          fields: JSON.stringify(input.fields),
          createdAt: Date.now(),
          read: 0,
          sourceUrl: input.source?.url ?? null,
          sourceReferrer: input.source?.referrer ?? null,
          sourceUserAgent: input.source?.userAgent ?? null
        })
        .run()
      return read(id)!
    },
    async getSubmission(id) {
      return read(id)
    },
    async listSubmissions(filter) {
      const conds = []
      if (filter?.formId !== undefined)
        conds.push(eq(submissions.formId, filter.formId))
      if (filter?.read !== undefined)
        conds.push(eq(submissions.read, filter.read ? 1 : 0))
      // q: case-insensitive substring over field VALUES only (not keys) via json_each.
      if (filter?.q)
        conds.push(
          sql`EXISTS (SELECT 1 FROM json_each(${submissions.fields}) WHERE lower(json_each.value) LIKE ${'%' + filter.q.toLowerCase() + '%'})`
        )
      const where = conds.length ? and(...conds) : undefined

      const totalRow = db
        .select({ n: sql<number>`count(*)` })
        .from(submissions)
        .where(where)
        .get()
      const total = totalRow?.n ?? 0

      let qy = db
        .select()
        .from(submissions)
        .where(where)
        .orderBy(desc(submissions.createdAt), desc(submissions.id))
        .$dynamic()
      // SubmissionFilter marks limit and offset independently optional, and
      // db-memory honours offset alone by defaulting limit to the row count
      // (submission-port.ts's `limit = all.length`). SQLite rejects a bare OFFSET,
      // so an offset-only filter threw a syntax error here (#897). `total` is that
      // same row count under the same `where`, so it caps nothing and reproduces
      // db-memory's default exactly. SQLite's own "no limit" spelling, LIMIT -1,
      // is NOT usable: drizzle drops a negative numeric limit from the generated
      // query (putting the bare OFFSET straight back) and its `.limit()` signature
      // rejects an `sql` fragment.
      // Enforced by the offset-without-limit case in packages/db-testing/src/index.ts.
      if (filter?.limit !== undefined) qy = qy.limit(filter.limit)
      else if (filter?.offset !== undefined) qy = qy.limit(total)
      if (filter?.offset !== undefined) qy = qy.offset(filter.offset)
      return { rows: qy.all().map(rowToSubmission), total }
    },
    async setRead(ids, readFlag) {
      if (ids.length === 0) return
      for (const id of ids)
        db.update(submissions)
          .set({ read: readFlag ? 1 : 0 })
          .where(eq(submissions.id, id))
          .run()
    },
    async deleteSubmissions(ids) {
      for (const id of ids)
        db.delete(submissions).where(eq(submissions.id, id)).run()
    },
    async distinctForms() {
      return selectDistinctForms(
        db.select().from(submissions).all().map(rowToSubmission)
      )
    },
    async close() {
      sqlite.close()
    }
  }
}
